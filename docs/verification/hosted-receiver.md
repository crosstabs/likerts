# Hosted callback receiver preparation

Verified 13 September 2026. The isolated receiver now has actual Vercel/Redis evidence for authentication, marker visibility and duplicate acknowledgment during its eight-second hold. This was an H06 prerequisite at the time; the real hosted worker-loss, DNS and rollback work subsequently passed on 15 September in the [combined recovery evidence](hosted-callback-recovery.md).

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

At this checkpoint, the [failure-drill procedure](../operations/HOSTED-FAILURE-DRILL.md) still required actual API/worker delivery, reviewed isolated process topology, an expired old lease and successful new attempt, export winning-fence evidence, DNS validation/restoration and compatible rollback. Those bounded H06 tests are now complete in the [15 September evidence](hosted-callback-recovery.md). They do not remove H03/H04 or account-access prerequisites.

## Direct preview URL reachability — 13 September 2026

At 11:43:54–11:44:11 UTC, one temporary **preview** deployment of the unchanged receiver source `1757db408568f34013ac0d265269c91735001415` passed direct-route checks. Its signing-key map was empty; it received no real worker event. This resolves a receiver access prerequisite and does not establish webhook recovery.

Vercel rejected an earlier attempt to put the existing production deployment URL in Deployment Protection Exceptions with HTTP 400, `Cannot add a production alias to Deployment Protection Exceptions`. Its direct URL remained protected. The controller then created the separate empty preview and applied the documented exact-URL protection override to its deployment ID. The project-wide protection setting remained `all_except_custom_domains`; existing receiver aliases were unchanged. [Vercel exception scope](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/deployment-protection-exceptions), [URL override API](https://vercel.com/docs/rest-api/aliases/update-the-protection-bypass-for-a-url)

Requests used ordinary HTTPS with redirects refused and **no Vercel bypass header, query secret or cookie**:

| Check | Observed result |
| --- | --- |
| Before override | 302 to Vercel SSO. |
| Anonymous receipt read after propagation | Application JSON 401 `unauthorized`. |
| Receiver-admin receipt read | 200 with zero events and zero received count. |
| Malformed unsigned POST | Application JSON 400 `invalid_delivery_ids`; this is parser denial, not a valid-envelope HMAC test. |
| Existing production receiver deployment | Still 302 to Vercel SSO. |
| After override revocation | 302 to Vercel SSO restored. |

Immediate requests after the first override/revocation attempt saw inconsistent propagation; even an authorized request could still reach SSO after an anonymous request reached the application. The final probe used bounded observation of each relevant request shape before claiming readiness, and independently observed restored protection after revocation. A successful settings response alone is insufficient.

The preview used four fresh acceptance variables, a new Redis namespace and administrator token, and the existing fixture Redis credentials. Those two existing sensitive Redis variables temporarily gained the preview target through target-only updates; their values were neither read nor changed. Cleanup completed at 11:44:59 UTC: the temporary deployment was deleted and absent from inventory, its four preview variables were removed, the two Redis targets were restored to production only, and the original project protection was reverified. No new project, plan upgrade, custom DNS record, production alias reassignment or project-wide protection change occurred. The empty Redis namespace retains the receiver's bounded TTL behavior; physical expiry was not independently observed.

A real worker test must use a fresh signed preview with the same direct-access checks. Because endpoint creation returns its signing key and endpoint URLs cannot be edited, use one newly owned stable preview alias: point it to an empty preview, create the disabled endpoint, deploy its actual key, move only that alias to the signed preview, verify identity/access/empty receipts, and then enable the endpoint. Verify the alias's exact deployment/project before adding its exception; remove only that alias/override and the owned deployments during cleanup. This sequence is prepared work, not an executed callback claim.
