# AWS staging infrastructure

**Optional alternate target.** The launch platform is now [Render Singapore](../render/README.md). This CDK remains available for a future AWS deployment; its local synth results are not Render deployment evidence.

This directory contains the repeatable AWS CDK definition for the selected Singapore ECS Fargate, RDS PostgreSQL and private S3 architecture. Synthesis and assertions run without an AWS account or credentials. They prove the CloudFormation shape; they do not prove that an account accepted it or that the hosted system works.

## Local gate

From the repository root:

```sh
bash scripts/check-aws-iac.sh
```

The gate typechecks the stack, runs synth-time assertions, and synthesizes staging and production templates with all AWS credential environment variables removed. Staging uses one API task, one callback worker, one NAT gateway and a single-AZ database. The `stage=production` context enables two API tasks, two callback workers, two NAT gateways, RDS Multi-AZ, Performance Insights and ALB deletion protection.

The stack creates:

- a two-AZ VPC with public ALB, private service, private callback and isolated database subnets, rejected-flow logging and an S3 gateway endpoint;
- HTTPS ALB input through an ACM certificate ARN parameter, HTTP redirect, exact ALB-to-service-to-database security-group paths and no public RDS endpoint;
- separate runtime, callback-worker and migration Fargate task definitions, task roles, execution roles, secrets and security groups, with ECS Exec disabled and read-only root filesystems;
- PostgreSQL 17 with forced TLS, KMS encryption, seven-day backups, retained automated backups, deletion protection and retained snapshots;
- a KMS-encrypted, public-blocked export bucket whose `exports/` objects expire after one day, matching `LIKERTS_EXPORT_BUCKET`, `LIKERTS_EXPORT_PREFIX=exports` and `LIKERTS_REQUIRE_S3=1` in the implemented backend adapter;
- WAF managed common rules and a five-minute IP rate limit scoped to `/v1/collections/`, with Authorization headers redacted from WAF logs;
- retained ALB, VPC, WAF, ECS and RDS logs, eight CloudWatch alarms, an encrypted SNS alarm topic and private Cloud Map discovery;
- outputs needed by the migration command, smoke gate and external DNS configuration.

The generated database passwords contain URL-safe alphanumeric characters because each task constructs its TLS-required PostgreSQL URI in memory. CloudFormation and task definitions contain Secrets Manager references, not passwords. ECS execution roles can read only their corresponding database secrets; the runtime execution role additionally reads the dedicated collection-credential and webhook-credential key secrets. The callback execution role reads only its own database secret and the separate webhook key; its task role has no AWS API permissions. The migration job never receives either credential key. The runtime task role has only `GetObject`, `PutObject`, `DeleteObject` and prefix-bounded `ListBucket` access for `exports/`, plus the KMS operations required for those objects. The migration task role has no S3 access. Do not add development authentication variables or ECS Exec.

## First staging deployment

Bootstrap and deploy only from the intended AWS account and `ap-southeast-1`. Before deployment, create two distinct dedicated Secrets Manager secrets (collection credentials and webhook credentials), each of whose entire `SecretString` is 32 cryptographically random bytes encoded with standard base64; record its ARN without reading the value back. Each key must survive task replacement because PostgreSQL idempotent collection creation derives the original credential from it. Restrict mutation to the deployment security role and monitor changes. Use a tested digest, never a mutable image tag:

```sh
cd infrastructure/aws
npx cdk bootstrap aws://ACCOUNT_ID/ap-southeast-1
npx cdk deploy Likerts-staging \
  --parameters 'ImageUri=ACCOUNT_ID.dkr.ecr.ap-southeast-1.amazonaws.com/likerts@sha256:DIGEST' \
  --parameters 'CertificateArn=arn:aws:acm:ap-southeast-1:ACCOUNT_ID:certificate/CERTIFICATE_ID' \
  --parameters 'CollectionCredentialKeySecretArn=arn:aws:secretsmanager:ap-southeast-1:ACCOUNT_ID:secret:likerts-staging-collection-key-SUFFIX' \
  --parameters 'WebhookCredentialKeySecretArn=arn:aws:secretsmanager:ap-southeast-1:ACCOUNT_ID:secret:likerts-staging-webhook-key-SUFFIX' \
  --parameters 'OidcIssuer=https://clerk.staging.likerts.example' \
  --parameters 'OidcAudience=https://api.staging.likerts.example' \
  --parameters 'OidcJwksUrl=https://clerk.staging.likerts.example/.well-known/jwks.json'
```

Before deploying the service, use the migration-task outputs with `aws ecs run-task`, the private service subnet IDs and `MigrationSecurityGroupId`. Wait for exit code zero and retain its log reference. Apply `backend/provision-runtime.sql` through a controlled migration-owner session using the generated runtime-secret username and password; verify the runtime role is `NOINHERIT NOBYPASSRLS`, cannot migrate and can connect with `sslmode=verify-full` using the current RDS CA bundle. The stack sets `sslmode=require` as a minimum boot contract; the deployment gate must override the task command or update the application connection configuration to verify the RDS hostname and CA before OPS-01 can close.

Subscribe the on-call destination to `AlarmTopicArn`, validate subscription, point customer DNS at `AlbDnsName`, then run health, OAuth/service authorization, collection submission, retrieval, usage and S3 export/download/revocation smoke checks. Confirm WAF, ALB, service, RDS and bucket metrics/logs arrive without bearer tokens or response bodies. Hosted evidence must record stack change set, image digest, task definition revisions, migration exit, smoke results and alarm delivery.

## Promotion and rollback

Create and review a CloudFormation change set before each deployment. Record the previous image digest and task definition, database migration boundary and whether the old image is compatible with the expanded schema. Run the migration task first. If it fails, stop without updating the service.

Deploy the new service revision with the ECS deployment circuit breaker enabled. A failed health deployment automatically returns to the last healthy task set; confirm this in AWS and run the smoke checks again. Rehearse one deliberately unhealthy image in staging and record the rollback event and elapsed time before claiming rollback works.

Do not automatically roll back a committed database migration. Migrations must use expand/contract compatibility. If a new revision accepts data before failure, keep the database, return to the compatible previous image, reconcile usage and preserve deletion/revocation journals. A database restore is an incident procedure because it can discard accepted responses; follow `infrastructure/OPERATIONS.md` and replay deletions before traffic resumes.

Destroying staging does not delete the database snapshots, KMS key, secrets, export objects or retained log groups. Inventory and remove retained resources only under an approved environment-retirement procedure. Production uses `npx cdk deploy -c stage=production Likerts-production` after staging evidence passes; synthesis alone is not authorization to provision it.

## Callback worker provisioning

After migration 0017 and runtime provisioning, create the `likerts_webhook_worker` login using the generated `WebhookCredentialSecretArn` in a controlled owner session, with `NOINHERIT NOBYPASSRLS NOCREATEDB NOCREATEROLE` and no memberships. Run `infrastructure/webhooks/provision-worker.sql`. Keep callback service desired count zero in the reviewed deployment change set until migration/provisioning checks pass, then use the configured staging/production desired count. The first stack creation otherwise starts services before SQL roles are provisioned, so complete initial bootstrap before expecting healthy tasks.

The worker has a separate task, execution identity, database credential and callback subnets. Its callback-subnet ACL denies private destinations except RDS 5432 and explicit resolver DNS; security groups further restrict destination ports and RDS identity. Verify NAT paths, stateful-security-group return traffic, stateless ACL ephemeral return rules and actual private-address denial in staging. See `infrastructure/webhooks/README.md` for DNS's AWS-managed exception, signing-key rotation, HTTP semantics, receiver setup and restore quarantine. Imported key secrets encrypted under customer-managed KMS keys also require their KMS key policies to authorize the corresponding execution roles; an ARN import cannot infer that policy.
