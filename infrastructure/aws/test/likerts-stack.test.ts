import assert from "node:assert/strict";
import test from "node:test";
import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { LikertsStack } from "../lib/likerts-stack";

function stack(production: boolean): Template {
  const app = new App();
  return Template.fromStack(
    new LikertsStack(app, production ? "Production" : "Staging", {
      stage: production ? "production" : "staging",
      production,
      env: { account: "111111111111", region: "ap-southeast-1" }
    })
  );
}

test("staging synthesizes isolated network, TLS ingress, private database and encrypted exports", () => {
  const template = stack(false);
  template.resourceCountIs("AWS::EC2::Subnet", 8);
  template.hasResourceProperties("AWS::ElasticLoadBalancingV2::Listener", {
    Port: 443,
    Protocol: "HTTPS",
    Certificates: Match.arrayWith([Match.objectLike({ CertificateArn: Match.anyValue() })])
  });
  template.hasResourceProperties("AWS::RDS::DBInstance", {
    BackupRetentionPeriod: 7,
    DeletionProtection: true,
    MultiAZ: false,
    PubliclyAccessible: false,
    StorageEncrypted: true,
    Engine: "postgres"
  });
  template.hasResourceProperties("AWS::RDS::DBParameterGroup", {
    Parameters: Match.objectLike({ "rds.force_ssl": "1" })
  });
  template.hasResourceProperties("AWS::S3::Bucket", {
    BucketEncryption: {
      ServerSideEncryptionConfiguration: Match.arrayWith([
        Match.objectLike({ ServerSideEncryptionByDefault: Match.objectLike({ SSEAlgorithm: "aws:kms" }) })
      ])
    },
    PublicAccessBlockConfiguration: {
      BlockPublicAcls: true,
      BlockPublicPolicy: true,
      IgnorePublicAcls: true,
      RestrictPublicBuckets: true
    },
    LifecycleConfiguration: {
      Rules: Match.arrayWith([
        Match.objectLike({ ExpirationInDays: 1, Prefix: "exports/", Status: "Enabled" })
      ])
    }
  });
  template.resourceCountIs("AWS::ECS::TaskDefinition", 3);
  template.hasResourceProperties("AWS::ECS::Service", {
    DesiredCount: 1,
    EnableExecuteCommand: false,
    NetworkConfiguration: Match.objectLike({
      AwsvpcConfiguration: Match.objectLike({ AssignPublicIp: "DISABLED" })
    })
  });
  template.hasResourceProperties("AWS::WAFv2::WebACL", {
    Scope: "REGIONAL",
    Rules: Match.arrayWith([
      Match.objectLike({
        Name: "CollectionRateLimit",
        Statement: Match.objectLike({ RateBasedStatement: Match.objectLike({ Limit: 1000 }) })
      })
    ])
  });
  template.resourceCountIs("AWS::CloudWatch::Alarm", 8);
  template.resourceCountIs("AWS::ServiceDiscovery::PrivateDnsNamespace", 1);
});

test("production switch enables Multi-AZ database, two tasks, two NAT gateways and ALB protection", () => {
  const template = stack(true);
  template.hasResourceProperties("AWS::RDS::DBInstance", {
    MultiAZ: true,
    DeletionProtection: true,
    EnablePerformanceInsights: true
  });
  template.hasResourceProperties("AWS::ECS::Service", { DesiredCount: 2 });
  template.resourceCountIs("AWS::EC2::NatGateway", 2);
  template.hasResourceProperties("AWS::ElasticLoadBalancingV2::LoadBalancer", {
    LoadBalancerAttributes: Match.arrayWith([
      { Key: "deletion_protection.enabled", Value: "true" }
    ])
  });
  template.hasResourceProperties("AWS::WAFv2::WebACL", {
    Rules: Match.arrayWith([
      Match.objectLike({
        Name: "CollectionRateLimit",
        Statement: Match.objectLike({ RateBasedStatement: Match.objectLike({ Limit: 3000 }) })
      })
    ])
  });
});

test("runtime and migration identities receive only their own secret and runtime owns export-prefix access", () => {
  const rendered = stack(false).toJSON() as {
    Resources: Record<string, { Type: string; Properties?: Record<string, unknown> }>;
  };
  const resources = rendered.Resources;
  const executionRoles = Object.entries(resources)
    .filter(([id, resource]) => resource.Type === "AWS::IAM::Role" && id.includes("ExecutionRole"))
    .map(([id]) => id);
  assert.equal(executionRoles.length, 3);

  const secretPolicies = Object.values(resources).filter((resource) => {
    if (resource.Type !== "AWS::IAM::Policy") return false;
    return JSON.stringify(resource.Properties).includes("secretsmanager:GetSecretValue");
  });
  assert.equal(secretPolicies.length, 3);
  for (const policy of secretPolicies) {
    const encoded = JSON.stringify(policy.Properties);
    assert(!encoded.includes('"Resource":"*"'));
    assert(executionRoles.some((role) => encoded.includes(role)));
    assert.equal(executionRoles.filter((role) => encoded.includes(role)).length, 1);
  }

  const taskDefinitions = Object.values(resources).filter(
    (resource) => resource.Type === "AWS::ECS::TaskDefinition"
  );
  assert.equal(taskDefinitions.length, 3);
  for (const task of taskDefinitions) {
    const encoded = JSON.stringify(task.Properties);
    assert(encoded.includes('"ReadonlyRootFilesystem":true'));
    assert(encoded.includes('"Secrets"'));
    assert(encoded.includes("sslmode=require"));
  }
  const runtimeTask = taskDefinitions.find((task) =>
    JSON.stringify(task.Properties).includes("LIKERTS_REQUIRE_S3")
  );
  assert(runtimeTask, "runtime task missing required S3 configuration");
  assert(JSON.stringify(runtimeTask.Properties).includes('"Value":"1"'));
  assert(JSON.stringify(runtimeTask.Properties).includes("LIKERTS_COLLECTION_CREDENTIAL_KEY"));
  const migrationTask = taskDefinitions.find((task) => JSON.stringify(task.Properties).includes("likerts-migrate"));
  assert(migrationTask, "migration task missing");
  assert(!JSON.stringify(migrationTask.Properties).includes("LIKERTS_COLLECTION_CREDENTIAL_KEY"));

  const exportPolicy = Object.values(resources).find(
    (resource) => resource.Type === "AWS::IAM::Policy" && JSON.stringify(resource.Properties).includes("/exports/*")
  );
  assert(exportPolicy, "runtime export-prefix policy missing");
  const exportPolicyText = JSON.stringify(exportPolicy.Properties);
  for (const action of ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]) {
    assert(exportPolicyText.includes(action));
  }
  assert(!exportPolicyText.includes("s3:*"));
});

test("deployment inputs and operational outputs remain explicit", () => {
  const rendered = stack(false).toJSON() as {
    Parameters: Record<string, unknown>;
    Outputs: Record<string, unknown>;
  };
  for (const parameter of [
    "ImageUri",
    "CertificateArn",
    "OidcIssuer",
    "OidcAudience",
    "OidcJwksUrl",
    "CollectionCredentialKeySecretArn"
  ]) {
    assert(parameter in rendered.Parameters);
  }
  assert.equal(
    (rendered.Parameters.CollectionCredentialKeySecretArn as { NoEcho?: boolean }).NoEcho,
    true
  );
  for (const output of [
    "AlbDnsName",
    "ClusterName",
    "ServiceName",
    "RuntimeTaskDefinitionArn",
    "MigrationTaskDefinitionArn",
    "MigrationSecurityGroupId",
    "ServiceSubnetIds",
    "DatabaseEndpoint",
    "RuntimeCredentialSecretArn",
    "MigrationCredentialSecretArn",
    "ExportBucketName",
    "AlarmTopicArn",
    "ServiceDiscoveryName"
  ]) {
    assert(output in rendered.Outputs, `missing output ${output}`);
  }
  const renderedTasks = Object.values((stack(false).toJSON() as { Resources: Record<string, any> }).Resources)
    .filter((resource: any) => resource.Type === "AWS::ECS::TaskDefinition");
  const api = renderedTasks.find((task: any) => JSON.stringify(task.Properties).includes("LIKERTS_REQUIRE_S3"));
  assert(api);
  for (const name of ["LIKERTS_OIDC_ISSUER", "LIKERTS_OIDC_AUDIENCE", "LIKERTS_OIDC_JWKS_URL"])
    assert(JSON.stringify(api.Properties).includes(name), `API missing ${name}`);
});


test("webhook worker has separate credentials, no customer-data AWS rights, bounded network and monitored service", () => {
  for (const production of [false,true]) {
    const template=stack(production);const rendered=template.toJSON() as { Resources:Record<string,{Type:string;Properties:any}>;Parameters:Record<string,any> };
    const entries=Object.entries(rendered.Resources);
    const worker=entries.find(([id,r])=>r.Type==="AWS::ECS::TaskDefinition" && id.startsWith("WebhookTask"))![1].Properties;
    const api=entries.find(([id,r])=>r.Type==="AWS::ECS::TaskDefinition" && id.startsWith("RuntimeTask"))![1].Properties;
    const migration=entries.find(([id,r])=>r.Type==="AWS::ECS::TaskDefinition" && id.startsWith("MigrationTask"))![1].Properties;
    assert.deepEqual(worker.ContainerDefinitions[0].Secrets.map((s:any)=>s.Name).sort(),["DB_PASSWORD","DB_USERNAME","LIKERTS_WEBHOOK_CREDENTIAL_KEY"]);
    assert(JSON.stringify(worker).includes("WebhookDatabaseCredential"));
    for(const forbidden of ["RuntimeDatabaseCredential","MigrationDatabaseCredential","COLLECTION_CREDENTIAL","OIDC","STRIPE","EXPORT_BUCKET"])assert(!JSON.stringify(worker).includes(forbidden));
    assert(JSON.stringify(api).includes("LIKERTS_WEBHOOK_CREDENTIAL_KEY"));assert(!JSON.stringify(api).includes("WebhookDatabaseCredential"));
    assert(!JSON.stringify(migration).includes("WebhookCredentialKey"));assert(!JSON.stringify(migration).includes("WebhookDatabaseCredential"));
    assert(worker.ContainerDefinitions[0].HealthCheck.Command.join(" ").includes("LIKERTS_WEBHOOK_CHECK_CONFIG=1"));
    const taskRole=entries.find(([id,r])=>r.Type==="AWS::IAM::Role"&&id.startsWith("WebhookTaskRole"))![0];
    for(const [,r]of entries.filter(([,r])=>r.Type==="AWS::IAM::Policy")) assert(!(r.Properties.Roles??[]).some((role:any)=>role.Ref===taskRole),"worker task role must not receive AWS API permissions");
    const executionPolicy=entries.find(([id,r])=>r.Type==="AWS::IAM::Policy"&&id.startsWith("WebhookExecutionRole"))![1];
    for(const forbidden of ["s3:","RuntimeDatabaseCredential","MigrationDatabaseCredential","CollectionCredentialKey"])assert(!JSON.stringify(executionPolicy).includes(forbidden));
    assert.equal(rendered.Parameters.WebhookCredentialKeySecretArn.NoEcho,true);
    const acl=entries.find(([id,r])=>r.Type==="AWS::EC2::NetworkAcl"&&id.startsWith("WebhookNetworkAcl"))![0];
    const aclRules=entries.filter(([,r])=>r.Type==="AWS::EC2::NetworkAclEntry"&&JSON.stringify(r.Properties.NetworkAclId).includes(acl)).map(([,r])=>r.Properties);
    for(const cidr of ["10.0.0.0/8","172.16.0.0/12","192.168.0.0/16","169.254.0.0/16","100.64.0.0/10"])assert(aclRules.some(rule=>rule.Egress===true&&rule.CidrBlock===cidr&&rule.RuleAction==="deny"&&rule.RuleNumber<200));
    assert(aclRules.some(rule=>rule.Egress===true&&rule.RuleNumber===50&&rule.PortRange.From===5432&&rule.PortRange.To===5432&&rule.RuleAction==="allow"));
    for(const protocol of [6,17])assert(aclRules.some(rule=>rule.Egress===true&&Number(rule.Protocol)===protocol&&rule.PortRange?.From===53&&rule.PortRange?.To===53&&rule.RuleAction==="allow"&&JSON.stringify(rule.CidrBlock).includes("Fn::Cidr")));
    assert(aclRules.some(rule=>rule.Egress===false&&Number(rule.Protocol)===17&&rule.PortRange?.From===1024&&rule.PortRange?.To===65535&&JSON.stringify(rule.CidrBlock).includes("Fn::Cidr")));
    assert(aclRules.some(rule=>rule.Egress===false&&Number(rule.Protocol)===6&&rule.PortRange?.From===1024&&rule.PortRange?.To===65535&&rule.RuleAction==="allow"));
    const natRoutes=entries.filter(([id,r])=>id.includes("webhook")&&r.Type==="AWS::EC2::Route"&&r.Properties.DestinationCidrBlock==="0.0.0.0/0"&&r.Properties.NatGatewayId);assert.equal(natRoutes.length,2);
    const associations=entries.filter(([,r])=>r.Type==="AWS::EC2::SubnetNetworkAclAssociation"&&JSON.stringify(r.Properties.NetworkAclId).includes(acl));assert.equal(associations.length,2);for(const [,association]of associations)assert(JSON.stringify(association.Properties.SubnetId).includes("webhook"));
    const group=entries.find(([id,r])=>r.Type==="AWS::EC2::SecurityGroup"&&id.startsWith("WebhookSecurityGroup"))!;
    assert.equal((group[1].Properties.SecurityGroupIngress??[]).length,0);
    const egress=[...(group[1].Properties.SecurityGroupEgress??[]),...entries.filter(([,r])=>r.Type==="AWS::EC2::SecurityGroupEgress"&&JSON.stringify(r.Properties.GroupId).includes(group[0])).map(([,r])=>r.Properties)];
    assert(egress.length>=2);for(const rule of egress){assert(["tcp","udp"].includes(rule.IpProtocol));assert.equal(rule.FromPort,rule.ToPort);assert([53,443,5432].includes(rule.ToPort));if(rule.IpProtocol==="udp")assert.equal(rule.ToPort,53);if(rule.ToPort===53)assert(JSON.stringify(rule.CidrIp).includes("Fn::Cidr"));if(rule.ToPort===5432)assert(JSON.stringify(rule.DestinationSecurityGroupId).includes("DatabaseSecurityGroup"));}
    const service=entries.find(([id,r])=>r.Type==="AWS::ECS::Service"&&id.startsWith("WebhookService"))![1].Properties;
    assert.equal(service.DesiredCount,production?2:1);assert.equal(service.NetworkConfiguration.AwsvpcConfiguration.AssignPublicIp,"DISABLED");assert(!service.LoadBalancers);
    for(const name of ["WebhookCpuAlarm","WebhookFailuresAlarm","WebhookRunningAlarm"])assert(entries.some(([id,r])=>id.startsWith(name)&&r.Type==="AWS::CloudWatch::Alarm"));
  }
});
