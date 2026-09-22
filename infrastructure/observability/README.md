# Independent monitor watcher

These optional files prepare a separately hosted watcher for Likerts' Vercel
monitor. They do not arm, schedule or deploy it, and contain no alert recipient.
The existing `prometheus.yml`, `blackbox.yml` and `alerts.yml` remain the separate
per-instance API monitoring examples.

## Configuration

- Run Prometheus `prom/prometheus:v3.5.0` with `prometheus-monitor.yml` as its
  configuration and mount `monitor-alerts.yml` at `/etc/prometheus/monitor-alerts.yml`.
- Run `prom/blackbox-exporter:v0.28.0` with `blackbox-monitor.yml` as its configuration.
  The JSON CEL predicate requires that version; use the fixture below when upgrading.
- Resolve `blackbox-monitor:9115` on the private network shared with Prometheus.
  Do not publish the exporter port or give untrusted callers access to its
  `/probe` endpoint: a caller can supply an arbitrary target and send the configured
  bearer there. Restrict network access to the scraper and restrict exporter
  egress to the approved Likerts HTTPS origin and necessary DNS.
- Mount the production `CRON_SECRET` read-only at
  `/run/secrets/likerts_cron_secret`, readable only by the exporter identity.
  Do not put it in YAML, URLs, shell arguments, images or logs. Rotate the source
  secret and mounted file together. The heartbeat endpoint is read-only, but this
  credential also authorizes `/api/monitor`; it is **not a read-only credential**.
- Use an approved host outside the monitored Vercel/Render failure domain.
  Configure Prometheus' `alerting.alertmanagers` and an approved receiver, with
  authenticated private transport, named primary/backup responders and escalation.
  No Alertmanager destination is supplied here. Until that is configured and a
  human acknowledges the drills, the files do not establish active alerting.

The target is exactly `https://likerts.com/api/monitor-heartbeat`. The one-minute
probe requires HTTPS with certificate verification, no redirects, HTTP 200,
JSON content type, a `no-store` response and the expected `current` status and
coverage fields. Reads are limited to 4 KB. The endpoint enforces the twelve-minute
state-age limit; Blackbox validates the timestamp shape, **not its age independently**.
An unarmed monitor, stale/missing state, pending notification or degraded component
fails the probe. The request never advances the heartbeat or invokes `/api/monitor`.

The alert fires after two minutes of failed probes, failed exporter scrapes, or
missing probe metrics. With one-minute scraping/evaluation, detection takes up to
roughly four minutes after the endpoint becomes unhealthy. For a stopped monitor,
add the endpoint's twelve-minute freshness window. These are configuration bounds,
not measured hosted detection times or an SLA. Only one target is configured;
additional targets need per-target absence checks. A stopped Prometheus or a broken
notification path needs a separate dead-man check from the approved monitoring
provider; this rule cannot report its own evaluator's total outage.

## Verify and activate

Run `bash scripts/check-observability.sh` with Docker, Node 22 and OpenSSL available.
It validates both Prometheus configurations and exercises the alert rules, then
runs `node scripts/check-monitor-watcher.mjs` against a temporary TLS fixture with
synthetic credentials. Tests cover healthy and recovered state, failure/absence,
bad authorization, JSON/schema/header failures, oversized bodies, redirects,
plaintext transport and certificate hostname mismatch. The fixture trusts only
its temporary certificate in a test copy; the shipped configuration keeps normal
certificate validation. All fixture resources are removed. Docker must share the
checkout and support `host-gateway`; the exporter port binds only to loopback.

After the owner approves hosting and the destination, deploy these configurations,
verify the live protected endpoint, and prove failure, missing-run, failed-receiver
and recovery notification delivery with a recorded human acknowledgment. Verify
the provider's dead-man check too. Follow the activation sequence and safety
boundaries in [the operations runbook](../OPERATIONS.md). Keep H04 open until those
hosted checks pass; local tests do not prove deployment or notification delivery.

The module uses the upstream [Blackbox v0.28.0 configuration schema](https://github.com/prometheus/blackbox_exporter/blob/v0.28.0/CONFIGURATION.md).
