# Bounded hosted load acceptance

Run `node scripts/check-hosted-load.mjs` with these environment variables:

- `LIKERTS_HOSTED_BASE_URL`: exact HTTPS API origin.
- `LIKERTS_HOSTED_BOOTSTRAP_TOKEN`: an expiring scoped credential for a new synthetic workspace.
- `LIKERTS_HOSTED_TEMP_WORKSPACE`: that workspace's `hosted-launch-...` name.
- `LIKERTS_HOSTED_EVIDENCE_OUTPUT`: output JSON file path.

Provision a new workspace using the existing owner-only Render migration job and `/opt/likerts/render/bootstrap-rehearsal.sh WORKSPACE CREDENTIAL_UUID TOKEN_SHA256`. Generate the token locally with a cryptographic random generator; pass only its SHA-256 digest to the job. Wait for the job to succeed, then pass the raw token to the runner through its process environment. Do not put tokens in CLI arguments, source files or job commands. The runner does not need a database or provider credential.

The runner verifies the issued child credential belongs to the named workspace and requires a pristine 1,000-response promotional grant with no prior usage or paid balance. It sends 260 bounded submission attempts: 100 at five requests per second, 100 with up to ten concurrent requests, 20 retries sharing one key, ten invalid answers, ten unauthorized attempts and a 20-request race against a ten-response cap. Expected accounting is exactly 211 accepted responses, 211 promotional credits consumed, 789 remaining, and no paid consumption or debt.

Once the workspace binding and baseline pass, a `finally` block requests workspace tombstoning on success or failure and verifies both credentials are denied. It retries cleanup verification up to three times. A failed or interrupted run must not be reported as acceptance; inspect the evidence's cleanup flags and use the synthetic workspace name for operator cleanup if needed. A process killed before cleanup can leave the temporary workspace until an operator removes it; credential expiry alone is not data deletion.

Evidence contains aggregate latency, status counts, accounting, cleanup results and the synthetic workspace name. It excludes tokens, response payloads and provider credentials. `node infrastructure/render/check-hosted-load-evidence.mjs` validates the schema, exact phase/status distribution, accounting and cleanup, and proves undeclared secret-bearing fields are rejected. The check is included in `bash scripts/check-render-iac.sh`. The recorded `hosted-load-evidence.json` passed on the public Render API. This is a short correctness/latency rehearsal, not sustained capacity, replica failover, a service guarantee or a cost measurement.
