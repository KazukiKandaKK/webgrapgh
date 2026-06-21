import { Stack, StackProps } from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import { Construct } from "constructs";

/**
 * Production-shape VPC: 2 AZs, public + private-with-egress subnets, one
 * NAT gateway. Each downstream stack (Alb, Ecs) creates its own security
 * groups against this VPC — keeping SG ownership inside the stack that
 * also owns the resources they protect avoids cross-stack SG references
 * (and the cycles they cause when CDK auto-adds ingress rules).
 */
export class VpcStack extends Stack {
  public readonly vpc: ec2.IVpc;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);
    this.vpc = new ec2.Vpc(this, "Vpc", {
      maxAzs: 2,
      natGateways: 1,
      subnetConfiguration: [
        { name: "Public", subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        {
          name: "Private",
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 24,
        },
      ],
    });
  }
}
