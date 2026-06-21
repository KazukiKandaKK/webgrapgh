import { Stack, StackProps, Duration } from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as logs from "aws-cdk-lib/aws-logs";
import * as cloudmap from "aws-cdk-lib/aws-servicediscovery";
import { Construct } from "constructs";

export interface EcsStackProps extends StackProps {
  vpc: ec2.IVpc;
  // BFF tasks attach to this TG; ECS → ALB dependency only.
  bffTargetGroup: elbv2.IApplicationTargetGroup;
}

/**
 * ECS Fargate cluster with three services:
 *   - metrics-service (gRPC :50051, internal only via Cloud Map)
 *   - logs-service    (gRPC :50052, internal only via Cloud Map)
 *   - bff-service     (HTTP/WS :8080, fronted by ALB target group)
 *
 * SG ownership stays inside this stack so cross-stack auto-rules
 * (ECS-to-ALB ingress) don't create a cycle back to VpcStack.
 */
export class EcsStack extends Stack {
  public readonly cluster: ecs.Cluster;
  public readonly bffService: ecs.FargateService;
  public readonly metricsService: ecs.FargateService;
  public readonly logsService: ecs.FargateService;

  constructor(scope: Construct, id: string, props: EcsStackProps) {
    super(scope, id, props);

    this.cluster = new ecs.Cluster(this, "Cluster", {
      vpc: props.vpc,
      defaultCloudMapNamespace: { name: "webgrapgh.local" },
      containerInsights: false,
    });

    const logGroup = new logs.LogGroup(this, "AppLogs", {
      retention: logs.RetentionDays.ONE_WEEK,
    });

    // One SG for all 3 services. Self-ingress on 50051/50052/8080 lets BFF
    // reach the gRPC backends without exposing them outside the cluster.
    const serviceSg = new ec2.SecurityGroup(this, "ServiceSg", {
      vpc: props.vpc,
      description: "Inter-service traffic inside the cluster",
      allowAllOutbound: true,
    });
    serviceSg.addIngressRule(serviceSg, ec2.Port.tcp(50051), "metrics gRPC");
    serviceSg.addIngressRule(serviceSg, ec2.Port.tcp(50052), "logs gRPC");
    serviceSg.addIngressRule(serviceSg, ec2.Port.tcp(8080), "bff HTTP/WS");

    this.metricsService = this.makeGrpcService("Metrics", {
      family: "metrics-service",
      port: 50051,
      image: "webgrapgh-aws-metrics:latest",
      env: { PUSH_HZ: "20", HISTORY_SIZE: "20000", SEED_MINUTES: "60" },
      sg: serviceSg,
      logGroup,
      vpc: props.vpc,
    });

    this.logsService = this.makeGrpcService("Logs", {
      family: "logs-service",
      port: 50052,
      image: "webgrapgh-aws-logs:latest",
      env: { LOG_PUSH_HZ: "30", RING_SIZE: "30000" },
      sg: serviceSg,
      logGroup,
      vpc: props.vpc,
    });

    const bffTask = new ecs.FargateTaskDefinition(this, "BffTask", {
      family: "bff-service",
      cpu: 512,
      memoryLimitMiB: 1024,
    });
    bffTask.addContainer("bff", {
      image: ecs.ContainerImage.fromRegistry("webgrapgh-aws-bff:latest"),
      portMappings: [{ containerPort: 8080, protocol: ecs.Protocol.TCP }],
      environment: {
        METRICS_ADDR: "metrics-service.webgrapgh.local:50051",
        LOGS_ADDR: "logs-service.webgrapgh.local:50052",
        ALLOWED_ORIGINS: "https://example.com",
      },
      logging: ecs.LogDriver.awsLogs({ streamPrefix: "bff", logGroup }),
    });
    this.bffService = new ecs.FargateService(this, "BffService", {
      cluster: this.cluster,
      taskDefinition: bffTask,
      desiredCount: 2,
      securityGroups: [serviceSg],
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      cloudMapOptions: {
        name: "bff-service",
        dnsRecordType: cloudmap.DnsRecordType.A,
        dnsTtl: Duration.seconds(15),
      },
    });
    this.bffService.attachToApplicationTargetGroup(props.bffTargetGroup);
  }

  private makeGrpcService(
    id: string,
    opts: {
      family: string;
      port: number;
      image: string;
      env: Record<string, string>;
      sg: ec2.ISecurityGroup;
      logGroup: logs.ILogGroup;
      vpc: ec2.IVpc;
    },
  ): ecs.FargateService {
    const task = new ecs.FargateTaskDefinition(this, `${id}Task`, {
      family: opts.family,
      cpu: 256,
      memoryLimitMiB: 512,
    });
    task.addContainer(id.toLowerCase(), {
      image: ecs.ContainerImage.fromRegistry(opts.image),
      portMappings: [{ containerPort: opts.port, protocol: ecs.Protocol.TCP }],
      environment: opts.env,
      logging: ecs.LogDriver.awsLogs({
        streamPrefix: id.toLowerCase(),
        logGroup: opts.logGroup,
      }),
    });
    return new ecs.FargateService(this, `${id}Service`, {
      cluster: this.cluster,
      taskDefinition: task,
      desiredCount: 1,
      securityGroups: [opts.sg],
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      cloudMapOptions: {
        name: opts.family,
        dnsRecordType: cloudmap.DnsRecordType.A,
        dnsTtl: Duration.seconds(15),
      },
    });
  }
}
