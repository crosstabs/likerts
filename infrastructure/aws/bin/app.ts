#!/usr/bin/env node
import { App } from "aws-cdk-lib";
import { LikertsStack } from "../lib/likerts-stack";

const app = new App();
const stage = String(app.node.tryGetContext("stage") ?? "staging");
if (!/^[a-z][a-z0-9-]{0,20}$/.test(stage)) {
  throw new Error("stage must be a short lowercase identifier");
}

new LikertsStack(app, `Likerts-${stage}`, {
  stage,
  production: stage === "production",
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? "ap-southeast-1"
  }
});
