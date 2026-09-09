import {
  CfnOutput,
  CfnParameter,
  Duration,
  Fn,
  RemovalPolicy,
  Stack,
  StackProps,
  aws_certificatemanager as acm,
  aws_servicediscovery as cloudmap,
  aws_cloudwatch as cloudwatch,
  aws_cloudwatch_actions as cloudwatchActions,
  aws_ec2 as ec2,
  aws_ecs as ecs,
  aws_elasticloadbalancingv2 as elbv2,
  aws_iam as iam,
  aws_kms as kms,
  aws_logs as logs,
  aws_rds as rds,
  aws_s3 as s3,
  aws_secretsmanager as secretsmanager,
  aws_sns as sns,
  aws_wafv2 as wafv2
} from "aws-cdk-lib";
import { Construct } from "constructs";

export interface LikertsStackProps extends StackProps {
  readonly stage: string;
  readonly production: boolean;
}

export class LikertsStack extends Stack {
  constructor(scope: Construct, id: string, props: LikertsStackProps) {
    super(scope, id, props);

    const imageUri = new CfnParameter(this, "ImageUri", {
      type: "String",
      description: "Previously tested immutable ECR image digest (repository@sha256:...).",
      allowedPattern: "^.+@sha256:[0-9a-f]{64}$"
    });
    const certificateArn = new CfnParameter(this, "CertificateArn", {
      type: "String",
      description: "ACM certificate ARN for the public HTTPS listener."
    });
    const oidcIssuer = new CfnParameter(this, "OidcIssuer", {
      type: "String",
      description: "Exact HTTPS OIDC issuer from authorization-server metadata.",
      allowedPattern: "^https://[^?#]+$"
    });
    const oidcAudience = new CfnParameter(this, "OidcAudience", {
      type: "String",
      description: "Exact Likerts API audience.",
      minLength: 1
    });
    const oidcJwksUrl = new CfnParameter(this, "OidcJwksUrl", {
      type: "String",
      description: "Trusted HTTPS JWKS URL published by the configured OIDC provider.",
      allowedPattern: "^https://[^?#]+$"
    });
    const collectionCredentialKeySecretArn = new CfnParameter(this, "CollectionCredentialKeySecretArn", {
      type: "String",
      noEcho: true,
      description: "Secrets Manager ARN whose SecretString is a stable base64-encoded 32-byte collection credential key."
    });

    const webhookCredentialKeySecretArn = new CfnParameter(this, "WebhookCredentialKeySecretArn", {
      type: "String", noEcho: true,
      description: "Separate Secrets Manager SecretString: base64-encoded 32-byte webhook credential key, shared only by API and webhook worker."
    });

    const vpc = new ec2.Vpc(this, "Vpc", {
      maxAzs: 2,
      natGateways: props.production ? 2 : 1,
      restrictDefaultSecurityGroup: true,
      subnetConfiguration: [
        { name: "ingress", subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        { name: "service", subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 24 },
        { name: "webhook", subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 24 },
        { name: "database", subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 }
      ],
      flowLogs: {
        cloudwatch: {
          destination: ec2.FlowLogDestination.toCloudWatchLogs(
            new logs.LogGroup(this, "VpcFlowLogs", {
              retention: logs.RetentionDays.ONE_MONTH,
              removalPolicy: RemovalPolicy.RETAIN
            })
          ),
          trafficType: ec2.FlowLogTrafficType.REJECT
        }
      }
    });
    vpc.addGatewayEndpoint("S3Endpoint", {
      service: ec2.GatewayVpcEndpointAwsService.S3,
      subnets: [{ subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }]
    });

    // Callback tasks have their own subnet ACL: an SSRF failure cannot reach private HTTPS.
    // The only private destination exception is PostgreSQL, also restricted by security group.
    const resolverCidr = Fn.select(2, Fn.cidr(vpc.vpcCidrBlock, 3, "0"));
    const webhookAcl = new ec2.NetworkAcl(this, "WebhookNetworkAcl", { vpc, subnetSelection: { subnetGroupName: "webhook" } });
    webhookAcl.addEntry("Database", { ruleNumber: 50, direction: ec2.TrafficDirection.EGRESS, cidr: ec2.AclCidr.ipv4(vpc.vpcCidrBlock), traffic: ec2.AclTraffic.tcpPort(5432), ruleAction: ec2.Action.ALLOW });
    webhookAcl.addEntry("DnsUdp", { ruleNumber: 60, direction: ec2.TrafficDirection.EGRESS, cidr: ec2.AclCidr.ipv4(resolverCidr), traffic: ec2.AclTraffic.udpPort(53), ruleAction: ec2.Action.ALLOW });
    webhookAcl.addEntry("DnsTcp", { ruleNumber: 61, direction: ec2.TrafficDirection.EGRESS, cidr: ec2.AclCidr.ipv4(resolverCidr), traffic: ec2.AclTraffic.tcpPort(53), ruleAction: ec2.Action.ALLOW });
    webhookAcl.addEntry("DnsReturn", { ruleNumber: 60, direction: ec2.TrafficDirection.INGRESS, cidr: ec2.AclCidr.ipv4(resolverCidr), traffic: ec2.AclTraffic.udpPortRange(1024,65535), ruleAction: ec2.Action.ALLOW });
    for (const [index,cidr] of ["0.0.0.0/8","10.0.0.0/8","100.64.0.0/10","127.0.0.0/8","169.254.0.0/16","172.16.0.0/12","192.168.0.0/16","168.63.129.16/32","198.18.0.0/15","224.0.0.0/4","240.0.0.0/4"].entries()) {
      webhookAcl.addEntry(`PrivateDeny${index}`, { ruleNumber: 100+index, direction: ec2.TrafficDirection.EGRESS, cidr: ec2.AclCidr.ipv4(cidr), traffic: ec2.AclTraffic.allTraffic(), ruleAction: ec2.Action.DENY });
    }
    webhookAcl.addEntry("PublicEgress", { ruleNumber: 200, direction: ec2.TrafficDirection.EGRESS, cidr: ec2.AclCidr.anyIpv4(), traffic: ec2.AclTraffic.allTraffic(), ruleAction: ec2.Action.ALLOW });
    webhookAcl.addEntry("ReturnTraffic", { ruleNumber: 200, direction: ec2.TrafficDirection.INGRESS, cidr: ec2.AclCidr.anyIpv4(), traffic: ec2.AclTraffic.tcpPortRange(1024,65535), ruleAction: ec2.Action.ALLOW });

    const albSecurityGroup = new ec2.SecurityGroup(this, "AlbSecurityGroup", {
      vpc,
      allowAllOutbound: false,
      description: "Public TLS ingress only"
    });
    albSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), "Public HTTPS");
    albSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), "HTTP redirect");
    albSecurityGroup.addEgressRule(ec2.Peer.ipv4(vpc.vpcCidrBlock), ec2.Port.tcp(8080));

    const serviceSecurityGroup = new ec2.SecurityGroup(this, "ServiceSecurityGroup", {
      vpc,
      allowAllOutbound: false,
      description: "Runtime receives traffic only from the ALB"
    });
    serviceSecurityGroup.addIngressRule(albSecurityGroup, ec2.Port.tcp(8080), "ALB to API");
    serviceSecurityGroup.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), "HTTPS identity, payment and AWS APIs");
    serviceSecurityGroup.addEgressRule(ec2.Peer.ipv4(vpc.vpcCidrBlock), ec2.Port.udp(53), "VPC DNS");
    serviceSecurityGroup.addEgressRule(ec2.Peer.ipv4(vpc.vpcCidrBlock), ec2.Port.tcp(53), "VPC DNS fallback");

    const migrationSecurityGroup = new ec2.SecurityGroup(this, "MigrationSecurityGroup", {
      vpc,
      allowAllOutbound: false,
      description: "Attached only to one-off migration tasks"
    });
    migrationSecurityGroup.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), "AWS APIs and image pull");
    migrationSecurityGroup.addEgressRule(ec2.Peer.ipv4(vpc.vpcCidrBlock), ec2.Port.udp(53), "VPC DNS");
    migrationSecurityGroup.addEgressRule(ec2.Peer.ipv4(vpc.vpcCidrBlock), ec2.Port.tcp(53), "VPC DNS fallback");
    const webhookSecurityGroup = new ec2.SecurityGroup(this, "WebhookSecurityGroup", {
      vpc, allowAllOutbound: false, description: "Callback worker: outbound HTTPS and restricted PostgreSQL; no inbound listener"
    });
    webhookSecurityGroup.addEgressRule(ec2.Peer.ipv4(resolverCidr), ec2.Port.udp(53), "VPC resolver only");
    webhookSecurityGroup.addEgressRule(ec2.Peer.ipv4(resolverCidr), ec2.Port.tcp(53), "VPC resolver TCP fallback");
    webhookSecurityGroup.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), "Public HTTPS callbacks and AWS image/log transport");
    const databaseSecurityGroup = new ec2.SecurityGroup(this, "DatabaseSecurityGroup", {
      vpc,
      allowAllOutbound: false,
      description: "PostgreSQL accepts only runtime and migration tasks"
    });
    databaseSecurityGroup.addIngressRule(serviceSecurityGroup, ec2.Port.tcp(5432), "Runtime database access");
    databaseSecurityGroup.addIngressRule(migrationSecurityGroup, ec2.Port.tcp(5432), "Migration database access");
    databaseSecurityGroup.addIngressRule(webhookSecurityGroup, ec2.Port.tcp(5432), "Restricted callback worker database access");
    webhookSecurityGroup.addEgressRule(databaseSecurityGroup, ec2.Port.tcp(5432), "PostgreSQL only");
    serviceSecurityGroup.addEgressRule(databaseSecurityGroup, ec2.Port.tcp(5432), "PostgreSQL only");
    migrationSecurityGroup.addEgressRule(databaseSecurityGroup, ec2.Port.tcp(5432), "PostgreSQL only");

    const dataKey = new kms.Key(this, "DataKey", {
      enableKeyRotation: true,
      removalPolicy: RemovalPolicy.RETAIN,
      alias: `alias/likerts-${props.stage}-data`
    });
    const migrationSecret = new secretsmanager.Secret(this, "MigrationDatabaseCredential", {
      encryptionKey: dataKey,
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: "likerts_migration" }),
        generateStringKey: "password",
        excludePunctuation: true,
        passwordLength: 40
      }
    });
    const runtimeSecret = new secretsmanager.Secret(this, "RuntimeDatabaseCredential", {
      encryptionKey: dataKey,
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: "likerts_runtime" }),
        generateStringKey: "password",
        excludePunctuation: true,
        passwordLength: 40
      }
    });
    const webhookSecret = new secretsmanager.Secret(this, "WebhookDatabaseCredential", {
      encryptionKey: dataKey,
      generateSecretString: { secretStringTemplate: JSON.stringify({ username: "likerts_webhook_worker" }), generateStringKey: "password", excludePunctuation: true, passwordLength: 40 }
    });
    const webhookCredentialKey = secretsmanager.Secret.fromSecretCompleteArn(this, "WebhookCredentialKey", webhookCredentialKeySecretArn.valueAsString);
    const collectionCredentialKey = secretsmanager.Secret.fromSecretCompleteArn(
      this,
      "CollectionCredentialKey",
      collectionCredentialKeySecretArn.valueAsString
    );

    const database = new rds.DatabaseInstance(this, "Database", {
      engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_17 }),
      credentials: rds.Credentials.fromSecret(migrationSecret),
      databaseName: "likerts",
      instanceType: props.production
        ? ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MEDIUM)
        : ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MICRO),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [databaseSecurityGroup],
      publiclyAccessible: false,
      multiAz: props.production,
      allocatedStorage: 30,
      maxAllocatedStorage: 200,
      storageEncrypted: true,
      storageEncryptionKey: dataKey,
      backupRetention: Duration.days(7),
      deleteAutomatedBackups: false,
      deletionProtection: true,
      removalPolicy: RemovalPolicy.SNAPSHOT,
      autoMinorVersionUpgrade: true,
      cloudwatchLogsExports: ["postgresql", "upgrade"],
      cloudwatchLogsRetention: logs.RetentionDays.ONE_MONTH,
      monitoringInterval: Duration.seconds(60),
      enablePerformanceInsights: props.production,
      parameterGroup: new rds.ParameterGroup(this, "DatabaseParameters", {
        engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_17 }),
        parameters: { "rds.force_ssl": "1", log_connections: "1", log_disconnections: "1" }
      })
    });

    const exportBucket = new s3.Bucket(this, "ExportBucket", {
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: dataKey,
      bucketKeyEnabled: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      minimumTLSVersion: 1.2,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      versioned: false,
      lifecycleRules: [{ id: "ExpireExports", prefix: "exports/", expiration: Duration.days(1) }],
      removalPolicy: RemovalPolicy.RETAIN
    });
    const accessLogBucket = new s3.Bucket(this, "AccessLogBucket", {
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      lifecycleRules: [{ expiration: Duration.days(90) }],
      removalPolicy: RemovalPolicy.RETAIN
    });

    const cluster = new ecs.Cluster(this, "Cluster", { vpc, containerInsightsV2: ecs.ContainerInsights.ENHANCED });
    const namespace = new cloudmap.PrivateDnsNamespace(this, "Namespace", {
      name: `${props.stage}.likerts.internal`,
      vpc
    });
    const runtimeExecutionRole = new iam.Role(this, "RuntimeExecutionRole", {
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AmazonECSTaskExecutionRolePolicy")]
    });
    const migrationExecutionRole = new iam.Role(this, "MigrationExecutionRole", {
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AmazonECSTaskExecutionRolePolicy")]
    });
    const webhookExecutionRole = new iam.Role(this, "WebhookExecutionRole", {
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AmazonECSTaskExecutionRolePolicy")]
    });
    webhookSecret.grantRead(webhookExecutionRole);
    webhookCredentialKey.grantRead(webhookExecutionRole);
    webhookCredentialKey.grantRead(runtimeExecutionRole);
    runtimeSecret.grantRead(runtimeExecutionRole);
    collectionCredentialKey.grantRead(runtimeExecutionRole);
    migrationSecret.grantRead(migrationExecutionRole);

    const runtimeTaskRole = new iam.Role(this, "RuntimeTaskRole", {
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com")
    });
    runtimeTaskRole.addToPolicy(new iam.PolicyStatement({
      actions: ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
      resources: [exportBucket.arnForObjects("exports/*")]
    }));
    runtimeTaskRole.addToPolicy(new iam.PolicyStatement({
      actions: ["s3:ListBucket"],
      resources: [exportBucket.bucketArn],
      conditions: { StringLike: { "s3:prefix": ["exports/*"] } }
    }));
    dataKey.grantEncryptDecrypt(runtimeTaskRole);
    const migrationTaskRole = new iam.Role(this, "MigrationTaskRole", {
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com")
    });

    const runtimeLogs = new logs.LogGroup(this, "RuntimeLogs", {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.RETAIN
    });
    const runtimeTask = new ecs.FargateTaskDefinition(this, "RuntimeTask", {
      cpu: 512,
      memoryLimitMiB: 1024,
      executionRole: runtimeExecutionRole,
      taskRole: runtimeTaskRole,
      runtimePlatform: { cpuArchitecture: ecs.CpuArchitecture.ARM64, operatingSystemFamily: ecs.OperatingSystemFamily.LINUX }
    });
    const runtimeContainer = runtimeTask.addContainer("Api", {
      image: ecs.ContainerImage.fromRegistry(imageUri.valueAsString),
      readonlyRootFilesystem: true,
      logging: ecs.LogDrivers.awsLogs({ logGroup: runtimeLogs, streamPrefix: "api" }),
      environment: {
        DB_HOST: database.dbInstanceEndpointAddress,
        DB_NAME: "likerts",
        LIKERTS_BIND_ADDRESS: "0.0.0.0",
        LIKERTS_PORT: "8080",
        LIKERTS_EXPORT_BUCKET: exportBucket.bucketName,
        LIKERTS_EXPORT_PREFIX: "exports",
        LIKERTS_REQUIRE_S3: "1",
        LIKERTS_OIDC_ISSUER: oidcIssuer.valueAsString,
        LIKERTS_OIDC_AUDIENCE: oidcAudience.valueAsString,
        LIKERTS_OIDC_JWKS_URL: oidcJwksUrl.valueAsString,
        RUST_LOG: "info"
      },
      secrets: {
        DB_USERNAME: ecs.Secret.fromSecretsManager(runtimeSecret, "username"),
        DB_PASSWORD: ecs.Secret.fromSecretsManager(runtimeSecret, "password"),
        LIKERTS_COLLECTION_CREDENTIAL_KEY: ecs.Secret.fromSecretsManager(collectionCredentialKey),
        LIKERTS_WEBHOOK_CREDENTIAL_KEY: ecs.Secret.fromSecretsManager(webhookCredentialKey)
      },
      entryPoint: ["/bin/sh", "-c"],
      command: [
        "export DATABASE_URL=\"postgresql://$DB_USERNAME:$DB_PASSWORD@$DB_HOST:5432/$DB_NAME?sslmode=require\"; exec /usr/local/bin/likerts-server"
      ],
      healthCheck: {
        command: ["CMD-SHELL", "curl --fail --silent --max-time 2 http://127.0.0.1:8080/health || exit 1"],
        interval: Duration.seconds(10),
        timeout: Duration.seconds(3),
        retries: 3,
        startPeriod: Duration.seconds(20)
      }
    });
    runtimeContainer.addPortMappings({ containerPort: 8080, protocol: ecs.Protocol.TCP });

    const migrationLogs = new logs.LogGroup(this, "MigrationLogs", {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.RETAIN
    });
    const migrationTask = new ecs.FargateTaskDefinition(this, "MigrationTask", {
      cpu: 512,
      memoryLimitMiB: 1024,
      executionRole: migrationExecutionRole,
      taskRole: migrationTaskRole,
      runtimePlatform: { cpuArchitecture: ecs.CpuArchitecture.ARM64, operatingSystemFamily: ecs.OperatingSystemFamily.LINUX }
    });
    migrationTask.addContainer("Migrate", {
      image: ecs.ContainerImage.fromRegistry(imageUri.valueAsString),
      readonlyRootFilesystem: true,
      logging: ecs.LogDrivers.awsLogs({ logGroup: migrationLogs, streamPrefix: "migration" }),
      environment: { DB_HOST: database.dbInstanceEndpointAddress, DB_NAME: "likerts" },
      secrets: {
        DB_USERNAME: ecs.Secret.fromSecretsManager(migrationSecret, "username"),
        DB_PASSWORD: ecs.Secret.fromSecretsManager(migrationSecret, "password")
      },
      entryPoint: ["/bin/sh", "-c"],
      command: [
        "export LIKERTS_MIGRATION_DATABASE_URL=\"postgresql://$DB_USERNAME:$DB_PASSWORD@$DB_HOST:5432/$DB_NAME?sslmode=require\"; exec /usr/local/bin/likerts-migrate"
      ]
    });

    const webhookTaskRole = new iam.Role(this, "WebhookTaskRole", { assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com") });
    const webhookLogs = new logs.LogGroup(this, "WebhookLogs", { retention: logs.RetentionDays.ONE_MONTH, removalPolicy: RemovalPolicy.RETAIN });
    const webhookTask = new ecs.FargateTaskDefinition(this, "WebhookTask", {
      cpu: 256, memoryLimitMiB: 512, executionRole: webhookExecutionRole, taskRole: webhookTaskRole,
      runtimePlatform: { cpuArchitecture: ecs.CpuArchitecture.ARM64, operatingSystemFamily: ecs.OperatingSystemFamily.LINUX }
    });
    const webhookCommand = "export LIKERTS_WEBHOOK_DATABASE_URL=\"postgresql://$DB_USERNAME:$DB_PASSWORD@$DB_HOST:5432/$DB_NAME?sslmode=require\"; ";
    webhookTask.addContainer("Webhook", {
      image: ecs.ContainerImage.fromRegistry(imageUri.valueAsString), readonlyRootFilesystem: true,
      logging: ecs.LogDrivers.awsLogs({ logGroup: webhookLogs, streamPrefix: "webhook" }),
      environment: { DB_HOST: database.dbInstanceEndpointAddress, DB_NAME: "likerts", LIKERTS_WEBHOOK_CONCURRENCY: "4" },
      secrets: { DB_USERNAME: ecs.Secret.fromSecretsManager(webhookSecret, "username"), DB_PASSWORD: ecs.Secret.fromSecretsManager(webhookSecret, "password"), LIKERTS_WEBHOOK_CREDENTIAL_KEY: ecs.Secret.fromSecretsManager(webhookCredentialKey) },
      entryPoint: ["/bin/sh", "-c"], command: [webhookCommand + "exec /usr/local/bin/likerts-webhook-worker"],
      stopTimeout: Duration.seconds(30),
      healthCheck: { command: ["CMD-SHELL", webhookCommand + "LIKERTS_WEBHOOK_CHECK_CONFIG=1 /usr/local/bin/likerts-webhook-worker || exit 1"], interval: Duration.seconds(30), timeout: Duration.seconds(10), retries: 3, startPeriod: Duration.seconds(20) }
    });
    const webhookService = new ecs.FargateService(this, "WebhookService", {
      cluster, taskDefinition: webhookTask, desiredCount: props.production ? 2 : 1, assignPublicIp: false,
      securityGroups: [webhookSecurityGroup], vpcSubnets: { subnetGroupName: "webhook" },
      circuitBreaker: { rollback: true }, minHealthyPercent: 100, maxHealthyPercent: 200, enableExecuteCommand: false
    });
    webhookService.node.addDependency(database);
    const webhookFailures = new logs.MetricFilter(this, "WebhookFailures", {
      logGroup: webhookLogs, metricNamespace: "Likerts/Webhooks", metricName: `${props.stage}-worker-failures`,
      filterPattern: logs.FilterPattern.anyTerm("claim_failed", "dispatch_check_failed", "completion_persistence_failed"), metricValue: "1", defaultValue: 0
    });

    const loadBalancer = new elbv2.ApplicationLoadBalancer(this, "LoadBalancer", {
      vpc,
      internetFacing: true,
      securityGroup: albSecurityGroup,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      dropInvalidHeaderFields: true,
      deletionProtection: props.production,
      idleTimeout: Duration.seconds(30)
    });
    loadBalancer.logAccessLogs(accessLogBucket, "alb");
    loadBalancer.addListener("HttpRedirect", { port: 80, defaultAction: elbv2.ListenerAction.redirect({ protocol: "HTTPS", port: "443", permanent: true }) });
    const https = loadBalancer.addListener("Https", {
      port: 443,
      protocol: elbv2.ApplicationProtocol.HTTPS,
      certificates: [acm.Certificate.fromCertificateArn(this, "Certificate", certificateArn.valueAsString)],
      sslPolicy: elbv2.SslPolicy.RECOMMENDED_TLS
    });
    const targetGroup = https.addTargets("ApiTargets", {
      port: 8080,
      protocol: elbv2.ApplicationProtocol.HTTP,
      healthCheck: { path: "/health", healthyHttpCodes: "200", interval: Duration.seconds(15), timeout: Duration.seconds(5) },
      deregistrationDelay: Duration.seconds(30)
    });
    const service = new ecs.FargateService(this, "Service", {
      cluster,
      taskDefinition: runtimeTask,
      desiredCount: props.production ? 2 : 1,
      assignPublicIp: false,
      securityGroups: [serviceSecurityGroup],
      vpcSubnets: { subnetGroupName: "service" },
      circuitBreaker: { rollback: true },
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
      enableExecuteCommand: false,
      cloudMapOptions: { cloudMapNamespace: namespace, name: "api", dnsRecordType: cloudmap.DnsRecordType.A, dnsTtl: Duration.seconds(30) }
    });
    targetGroup.addTarget(service);
    service.node.addDependency(database);

    const wafLogs = new logs.LogGroup(this, "WafLogs", {
      logGroupName: `/aws-waf-logs/likerts-${props.stage}`,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.RETAIN
    });
    const webAcl = new wafv2.CfnWebACL(this, "WebAcl", {
      scope: "REGIONAL",
      defaultAction: { allow: {} },
      visibilityConfig: { cloudWatchMetricsEnabled: true, metricName: `likerts-${props.stage}-waf`, sampledRequestsEnabled: true },
      rules: [
        {
          name: "AwsCommonRules",
          priority: 0,
          overrideAction: { none: {} },
          statement: { managedRuleGroupStatement: { vendorName: "AWS", name: "AWSManagedRulesCommonRuleSet" } },
          visibilityConfig: { cloudWatchMetricsEnabled: true, metricName: "aws-common", sampledRequestsEnabled: true }
        },
        {
          name: "CollectionRateLimit",
          priority: 1,
          action: { block: {} },
          statement: {
            rateBasedStatement: {
              aggregateKeyType: "IP",
              limit: props.production ? 3000 : 1000,
              evaluationWindowSec: 300,
              scopeDownStatement: {
                byteMatchStatement: {
                  fieldToMatch: { uriPath: {} },
                  positionalConstraint: "STARTS_WITH",
                  searchString: "/v1/collections/",
                  textTransformations: [{ priority: 0, type: "NONE" }]
                }
              }
            }
          },
          visibilityConfig: { cloudWatchMetricsEnabled: true, metricName: "collection-rate", sampledRequestsEnabled: true }
        }
      ]
    });
    new wafv2.CfnWebACLAssociation(this, "WebAclAssociation", {
      resourceArn: loadBalancer.loadBalancerArn,
      webAclArn: webAcl.attrArn
    });
    new wafv2.CfnLoggingConfiguration(this, "WafLogging", {
      resourceArn: webAcl.attrArn,
      logDestinationConfigs: [wafLogs.logGroupArn],
      redactedFields: [{ singleHeader: { name: "authorization" } }]
    });

    const alarms = new sns.Topic(this, "AlarmTopic", { masterKey: dataKey });
    const action = new cloudwatchActions.SnsAction(alarms);
    for (const [name, metric, threshold] of [
      ["Alb5xx", targetGroup.metrics.httpCodeTarget(elbv2.HttpCodeTarget.TARGET_5XX_COUNT, { period: Duration.minutes(5), statistic: "sum" }), 5],
      ["WebhookCpu", webhookService.metricCpuUtilization({ period: Duration.minutes(5) }), 80],
      ["WebhookFailures", webhookFailures.metric({ period: Duration.minutes(5), statistic: "sum" }), 5],
      ["ServiceCpu", service.metricCpuUtilization({ period: Duration.minutes(5) }), 80],
      ["ServiceMemory", service.metricMemoryUtilization({ period: Duration.minutes(5) }), 80],
      ["DatabaseCpu", database.metricCPUUtilization({ period: Duration.minutes(5) }), 80],
      ["DatabaseFreeStorage", database.metricFreeStorageSpace({ period: Duration.minutes(5) }), 5 * 1024 * 1024 * 1024]
    ] as const) {
      const alarm = new cloudwatch.Alarm(this, `${name}Alarm`, {
        metric,
        threshold,
        evaluationPeriods: 2,
        comparisonOperator: name === "DatabaseFreeStorage" ? cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD : cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.BREACHING
      });
      alarm.addAlarmAction(action);
    }

    const webhookRunning = new cloudwatch.Alarm(this, "WebhookRunningAlarm", {
      metric: new cloudwatch.Metric({ namespace: "ECS/ContainerInsights", metricName: "RunningTaskCount", dimensionsMap: { ClusterName: cluster.clusterName, ServiceName: webhookService.serviceName }, statistic: "Minimum", period: Duration.minutes(5) }),
      threshold: props.production ? 2 : 1, evaluationPeriods: 2, comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD, treatMissingData: cloudwatch.TreatMissingData.BREACHING
    });
    webhookRunning.addAlarmAction(action);
    new CfnOutput(this, "WebhookTaskDefinitionArn", { value: webhookTask.taskDefinitionArn });
    new CfnOutput(this, "WebhookServiceName", { value: webhookService.serviceName });
    new CfnOutput(this, "WebhookSecurityGroupId", { value: webhookSecurityGroup.securityGroupId });
    new CfnOutput(this, "WebhookCredentialSecretArn", { value: webhookSecret.secretArn });

    new CfnOutput(this, "AlbDnsName", { value: loadBalancer.loadBalancerDnsName });
    new CfnOutput(this, "ClusterName", { value: cluster.clusterName });
    new CfnOutput(this, "ServiceName", { value: service.serviceName });
    new CfnOutput(this, "RuntimeTaskDefinitionArn", { value: runtimeTask.taskDefinitionArn });
    new CfnOutput(this, "MigrationTaskDefinitionArn", { value: migrationTask.taskDefinitionArn });
    new CfnOutput(this, "MigrationSecurityGroupId", { value: migrationSecurityGroup.securityGroupId });
    new CfnOutput(this, "ServiceSubnetIds", { value: vpc.selectSubnets({ subnetGroupName: "service" }).subnetIds.join(",") });
    new CfnOutput(this, "DatabaseEndpoint", { value: database.dbInstanceEndpointAddress });
    new CfnOutput(this, "RuntimeCredentialSecretArn", { value: runtimeSecret.secretArn });
    new CfnOutput(this, "MigrationCredentialSecretArn", { value: migrationSecret.secretArn });
    new CfnOutput(this, "ExportBucketName", { value: exportBucket.bucketName });
    new CfnOutput(this, "AlarmTopicArn", { value: alarms.topicArn });
    new CfnOutput(this, "ServiceDiscoveryName", { value: `api.${namespace.namespaceName}` });
  }
}
