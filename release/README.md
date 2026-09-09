# Local release rehearsal

Run the local REL-01A gate from the repository root:

```sh
./scripts/check-release-rehearsal.sh
```

The gate builds the real backend, starts a fresh PostgreSQL 17 container, applies migrations, and publishes `rehearsal-fixture.json`. Web, React Native, Swift, Android and Flutter each fetch that same immutable collection and submit a response through their public SDK client. The lifecycle driver then checks retrieval and JSON export, a concurrent duplicate that produces one response and one promotional debit, conflicting and invalid submissions that remain unbilled, six promotional responses leaving 994 credits and no postpaid debt, then local payment failure and signed webhook recovery for one separately seeded historical postpaid cent, throttling that remains unbilled, raw-response deletion and export revocation, collection revocation, and workspace deletion.

The historical fixture is inserted only into the disposable database through its migration identity; no current response debit is removed or rewritten. Payment recovery must leave promotional and paid balances unchanged. The run uses loopback development authentication, a local payment provider and temporary local object storage. It removes the database container and temporary artifacts on exit. A successful run rewrites `local-rehearsal-evidence.json` with the stable assertions; it contains no tokens, response bodies or customer data.

REL-01A is local evidence. Full REL-01 still requires Clerk and Stripe sandbox evidence, the hosted staging lifecycle and the physical-device matrix.
