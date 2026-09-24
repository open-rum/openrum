---
title: Rate limits
description: Configure Project ingest limits, understand 429 responses, and operate Redis-backed protection.
appliesTo: Alpha
---

OpenRUM applies rate limits at the Ingest edge so one traffic spike cannot consume an entire self-hosted Instance. The primary product control is the **Project Rate Limit**: one requests-per-second boundary shared by every DSN and Environment in a Project.

Open **Project settings → Data management → Rate limits** to see the effective value, choose an override, and select the over-limit strategy. Owner and Admin roles can save changes; other Project roles have read-only access.

## What is counted

The limit counts HTTP Ingest requests, not Events. One request can carry up to 100 Events, so a 5,000 requests/second limit is not the same as a measured 500,000 Events/second processing capacity. Actual capacity also depends on envelope size, Kafka acknowledgement latency, Consumer throughput, and ClickHouse inserts.

All DSNs and Environments in the Project draw from the same limit. This keeps the Project as the Alpha operational and cost boundary, but it also means a noisy test Environment can spend capacity needed by production.

## Two protection layers

| Layer              |       Current default | Scope              | When it runs                                         |
| ------------------ | --------------------: | ------------------ | ---------------------------------------------------- |
| Edge IP limit      | 1,000 requests/second | Resolved client IP | Before DSN authentication                            |
| Project Rate Limit | 5,000 requests/second | One Project        | After DSN and Origin checks, before reading the body |

The Project value can be overridden from 1 to 1,000,000 requests/second. Clearing the override returns the Project to the Instance default shown in the Console.

The IP layer is not a Project setting because the Project is not known yet. Behind Kubernetes Ingress or another reverse proxy, configure trusted proxy CIDRs so every browser is not mistaken for the gateway's single IP. See [Kubernetes and Helm](/docs/self-hosting/kubernetes/#declare-your-edge-or-the-per-ip-limit-becomes-one-shared-limit).

## Choose an over-limit strategy

### Exact reject

The first requests in a one-second window pass until the limit is reached; later requests receive `429`. This is an exact cap, but a burst can cut an active Session in half and make its data incomplete.

### Stable caller sampling

Over-limit requests are thinned by a stable caller hash. A caller tends to pass or be rejected as a whole, which preserves more complete Sessions and keeps rates comparable. The trade-off is an approximate cap: a single window can admit at most twice the configured limit.

This is overload protection, not normal-volume SDK sampling. Configure ordinary Event and API Request sampling in the adjacent **Sampling** tab under **Data management**. Use **Usage statistics** to inspect the resulting volume.

## HTTP response contract

An over-limit request returns:

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 1
X-OpenRUM-RateLimit-Scope: project
X-OpenRUM-RateLimit-Limit: 5000
```

`X-OpenRUM-RateLimit-Scope` is either `ip` or `project`. The limit header reports the ceiling that made the decision. Project responses expose these headers through CORS so browser diagnostics can read them; a pre-authentication IP rejection may not have enough trusted Project context to grant CORS access.

The Browser SDK keeps `429` batches queued and respects `Retry-After` before retrying. A retry queue reduces loss during short spikes, but it does not create unlimited storage or guarantee delivery during a sustained overload. Fix the traffic source or increase verified capacity instead of relying on retries indefinitely.

## Redis and multiple Ingest replicas

With Redis available, Ingest replicas share fixed one-second counters. If Redis is unavailable, every process falls back to a local counter at half the configured limit. This protects each process, but the aggregate Instance limit is no longer exact and changes with the replica count.

Treat Redis loss as degraded rate-limit enforcement. Follow the [Redis runbook](/docs/self-hosting/redis/) and verify IP and Project limiting after recovery.

## Size a Project limit

Start with production-like measurements rather than Demo traffic:

```text
required request rate = peak Events/second ÷ average Events/request
configured limit = required request rate ÷ target utilization
```

For example, 24,000 peak Events/second at an average of 8 Events/request needs 3,000 requests/second. At a 75% target utilization, begin testing around 4,000 requests/second. This is an input to a load test, not a published OpenRUM capacity figure. Keep enough headroom for reconnect bursts and Release rollouts, then validate with [Capacity planning](/docs/self-hosting/capacity/).

## Troubleshooting sustained 429 responses

1. Read `X-OpenRUM-RateLimit-Scope` and the request's `X-Request-ID`.
2. For `ip`, verify trusted-proxy configuration and look for many callers collapsing onto one address.
3. For `project`, check for duplicate SDK initialization, retry loops, an unexpectedly noisy Environment, or a sudden drop in Events per request.
4. Compare the configured requests/second value with real Ingest and dependency capacity before raising it.
5. If Redis is unhealthy, recover shared counting before interpreting aggregate rates.

## Current limitations

- Project-level rate-limit hit counts and trends are not persisted. The Console can show only whether the latest recorded Ingest rejection was rate limited; existing usage totals must not be treated as rate-limit counts.
- The Instance Project default and the edge IP ceiling are code defaults, not editable Instance Settings.
- Environments have no reservations within their shared Project boundary.
- Limits use fixed one-second windows; there is no configurable burst budget or token bucket.
- Alerts cannot yet trigger on sustained rate-limit rejection.

Related: [Project settings](/docs/product/project-settings/), [Capacity planning](/docs/self-hosting/capacity/), [Redis](/docs/self-hosting/redis/), and [Threat model](/docs/self-hosting/security/threat-model/).
