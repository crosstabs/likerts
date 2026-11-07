# Full-room reconnect overlap — 2026-11-06

The previous production room ceiling of24 socket leases could reject valid reconnects. A twelve-player room also has a dedicated host, so thirteen members need26 leases when each reconnects before a replaced worker's original lease expires. The per-member allowance is two and the lease grace remains45 seconds.

The regression uses actual HTTP admission and WebSocket authentication against an owned temporary SQLite file. It authenticates all twelve players and the host, closes/reopens the local server and durable store, and freezes the fixture clock so all thirteen old leases remain valid. No SQL state is injected, no member lease is cleared, and no other worker/service or real data is touched. This is a retained-lease replacement regression; it does not claim a physical process-crash or PostgreSQL failover test.

Before the change, the test reproduced the issue: the replacement host and ten of twelve players authenticated; two valid player reconnects received `connection_limit` at the24-lease ceiling. Before reaching that room ceiling, a third host connection was correctly denied while only14 total leases existed, demonstrating that the per-member limit was independently enforced.

The production default and validated maximum room ceiling are now26. The same regression passes: the host and all twelve players reconnect, the durable room contains exactly26 unexpired leases, and the excess host duplicate remains denied. The four-room policy,64 sockets per process, two leases per member,45-second grace, body/frame/rate/admission limits and player ceiling are unchanged. A deliberately lower configured room ceiling reduces available reconnect overlap; the default supports the full room. Four rooms times26 durable room leases yields104 across workers; it is not an infrastructure billing cap or a measured production concurrency guarantee.

`.env.example`, `PROTOCOL.md` and the internal backend README now match the26-lease default. The root owns corresponding public privacy/cost material and any service restart. The active crossplay service on port4781 was not restarted or modified by this check.

Focused command from `live-game`:

```sh
node --test --test-concurrency=1 --test-reporter=spec \
  test/backend-reconnect-capacity.test.mjs test/backend-configuration.test.mjs
```

Result: **9/9 passed**, zero skipped or failed,837ms. Before the correction the reconnect regression failed with ten of twelve player reconnects; after it, twelve of twelve passed. The new test increases the unique backend count to64 and expected all-files Node count to139; the root owns that final all-files run, which is not claimed here.

Source fingerprints:

- Combined backend fingerprint using the existing load-harness algorithm: `0495d608601cf7beb512b490ace5551660f9dc0f1989f7a0624a8323d3f0f020`.
- `server/app.mjs`: `e9525f047bc7b247d9bb9eeb56b5c29a62094d95635b70afbe1ac897ae19774c`.
- `test/backend-reconnect-capacity.test.mjs`: `8ca84b0773f034ebd127becd18b6f973742d0abafa2c937ed4bff8f1eefd1ff9`.
- `test/backend-configuration.test.mjs`: `b7c3fa130a450a97f65e14345efa1e508f564084f55afded647914073e6f420b`.

Owned temporary sockets, servers, stores and fixture files were closed/removed by the test. No investigation processes remain active. Earlier load and correctness evidence retains its earlier source fingerprints.
