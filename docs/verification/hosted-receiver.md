# Hosted callback receiver preparation

Verified 13 September 2026. The isolated receiver now has actual Vercel/Redis evidence for authentication, marker visibility and duplicate acknowledgment during its eight-second hold. **H06 remains open:** the accepted test event was signed by a local synthetic fixture, not emitted by the hosted API/worker; no abrupt process loss, expired worker lease, export reclaim, DNS transition or compatible Render rollback was exercised here.

## Reviewed source and environment

- [PR #25](https://github.com/crosstabs/likerts/pull/25) merged as `015d04e7877577c3429b692805282312b531862f`. Both [required PR checks](https://github.com/crosstabs/likerts/actions/runs/34741377430) and [merged-source checks](https://github.com/crosstabs/likerts/actions/runs/34741790142) passed. The PR receiver step reported 12 tests, 12 passes, zero failures and zero skips, including real Redis.
- The deployed five-file function bundle came from reviewed head `1757db408568f34013ac0d265269c91735001415`; individual source hashes and deployment metadata were retained privately. Node 22, `iad1`, 20-second function maximum; [receiver source and bounds](../../infrastructure/acceptance/receiver/README.md).
- Reused existing fixture project `prj_I5L6V4KjVRRGYLh3tbearmuypyDz` and its existing Redis configuration. Each phase used a fresh namespace; no new project, paid plan or production callback endpoint was created. A read-only query using the restricted callback-worker role found zero endpoints pointing to this existing test-project hostname before deployment.
- Deployment protection remained enabled. Test requests used the existing automation bypass through the CLI or its documented HTTP header; application bearer/HMAC checks remained required. This does not prove that a normal callback worker can reach the protected URL. [Vercel automation access](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation)

## Observed results

Initial empty-key deployment `dpl_GqkTmjoufSCrA7oE2y1wjLzFm7rP` was READY. At 06:04 UTC, unauthorized receipt reads returned 401, authorized reads returned 200 with zero receipts, and a POST with an unknown signing key returned 401. No event was accepted in that phase.

Temporary hold deployment `dpl_FCeDJGcKmsk1vdyBr212jEA1HDbS` used one local test signing key and a different fresh namespace. Seven bounded HTTP requests ran between 06:09:07 and 06:09:17 UTC:

| Observation | Actual result |
| --- | --- |
| Authenticated receipt visible before first reply | Passed; marker read completed 7,425.17 ms before the first POST completed. |
| First signed POST | 204 after 8,674.69 ms. |
| Identical event, new attempt ID, during first request | 204 after 570.75 ms, completing 6,853.98 ms before the first reply. |
| Durable distinct receipt | Exactly one; original delivery/attempt marker and validated response fields remained unchanged. |
| Tampered signature | 401; final receipt count remained one. |

These are measured request durations for this bounded fixture, not a throughput, p95 or availability claim. The receiver stored only synthetic UUIDs and a survey version; there were no response answers, respondent metadata or production API calls. Capacity and nonextending TTL checks passed in local/required CI; this remote phase did not fill the 2,000-record cap or wait for one-hour expiration.

## Cleanup and routing correction

Despite requesting `--skip-domain`, Vercel assigned its generated team alias to the temporary deployment. Cleanup detected this before deletion. The generated test alias was explicitly pointed back to the empty-key receiver; the older default project domain still pointed to its prior `dpl_6BofseWCzANpkgEfNSpqZUd8V6rg` deployment. No Likerts website/API domain or DNS record changed during these receiver checks.

At 06:12 UTC, the project defaults were restored to the original empty-key namespace, and Vercel returned **DELETED** for the exact temporary hold deployment; it was absent from subsequent project deployment inventory. The empty-key receiver remained READY. At 06:13 UTC, HTTP checks through the generated test alias again returned zero receipts for an authorized read and 401 for a request signed with the former test key.

The synthetic Redis namespace was not purged. Its configured nonextending one-hour TTL remains the cleanup mechanism; actual expiration has not been observed. Private scripts, request timing, sanitized summaries and credential material are kept outside Git with restricted local permissions.

## Remaining H06 acceptance

Use the [failure-drill procedure](../operations/HOSTED-FAILURE-DRILL.md) for actual API/worker delivery, reviewed isolated process topology, an expired old lease and successful new attempt, export winning-fence evidence, DNS validation/restoration and compatible rollback. The selected live API was observed as PID 1, so it fails the proposed child-PID interruption gate. This receiver verification does not remove the outstanding H03/H04, account-access or isolated-resource prerequisites.
