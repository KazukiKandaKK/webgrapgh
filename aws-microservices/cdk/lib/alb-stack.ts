import { Stack, StackProps, Duration } from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import { Construct } from "constructs";

export interface AlbStackProps extends StackProps {
  vpc: ec2.IVpc;
}

/**
 * Public ALB + target group for the BFF. The ECS stack attaches its Fargate
 * service to `bffTargetGroup` so the dependency goes ECS → ALB (one-way),
 * avoiding the cyclic stack reference that the other ordering creates.
 *
 * WebSocket-friendly tuning:
 *   - idle timeout 300s (default 60s would drop quiet WS connections)
 *   - sticky cookies (same browser → same BFF instance)
 *   - HTTP health check on /healthz
 */
export class AlbStack extends Stack {
  public readonly alb: elbv2.ApplicationLoadBalancer;
  public readonly bffTargetGroup: elbv2.ApplicationTargetGroup;

  constructor(scope: Construct, id: string, props: AlbStackProps) {
    super(scope, id, props);

    this.alb = new elbv2.ApplicationLoadBalancer(this, "Alb", {
      vpc: props.vpc,
      internetFacing: true,
      idleTimeout: Duration.seconds(300),
    });

    this.bffTargetGroup = new elbv2.ApplicationTargetGroup(this, "BffTg", {
      vpc: props.vpc,
      port: 8080,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.IP,
      deregistrationDelay: Duration.seconds(15),
      stickinessCookieDuration: Duration.hours(1),
      healthCheck: {
        path: "/healthz",
        healthyHttpCodes: "200",
        interval: Duration.seconds(15),
        timeout: Duration.seconds(5),
      },
    });

    this.alb.addListener("Http", {
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      defaultTargetGroups: [this.bffTargetGroup],
    });
  }
}
