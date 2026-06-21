#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { VpcStack } from "../lib/vpc-stack";
import { EcsStack } from "../lib/ecs-stack";
import { AlbStack } from "../lib/alb-stack";

const app = new cdk.App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? "ap-northeast-1",
};

const vpcStack = new VpcStack(app, "WebgraphVpc", { env });

// AlbStack creates the load balancer + target group. The ECS stack later
// attaches its BFF service to that TG, so dependency goes ECS → ALB only.
const albStack = new AlbStack(app, "WebgraphAlb", {
  env,
  vpc: vpcStack.vpc,
});
albStack.addDependency(vpcStack);

const ecsStack = new EcsStack(app, "WebgraphEcs", {
  env,
  vpc: vpcStack.vpc,
  bffTargetGroup: albStack.bffTargetGroup,
});
ecsStack.addDependency(vpcStack);
ecsStack.addDependency(albStack);
