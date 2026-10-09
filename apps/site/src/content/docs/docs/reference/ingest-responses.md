---
title: Ingest responses
description: Every status code and error code the Ingest endpoint returns, what causes it, and what the Browser SDK does with it.
appliesTo: Alpha
---

The Browser SDK sends batches to the Ingest endpoint, `POST /ingest/v1/envelope`. This page lists what that endpoint can answer. Use it when the browser's network panel shows a status you do not recognize, or when you are writing a client that talks to Ingest directly. The order in which the checks run is on [Event pipeline](/docs/self-hosting/event-pipeline/).

## Request requirements

| Requirement | Detail |
| --- | --- |
| Method and path | `POST /ingest/v1/envelope` |
| Key | One `X-OpenRUM-Key` header holding an active Project key |
| Content type | `application/json` |
| Encoding | None or `gzip` |
| Origin | The `Origin` header must match one of the Project's allowed Origins |
| Body | An Envelope with 1 to 100 Events |

Size limits are enforced on the body:

| Limit | Value |
| --- | --- |
| Uncompressed body | 1 MiB |
| Compressed (`gzip`) body | 256 KiB |
| Decompression ratio | 100 to 1 |

The browser first sends an `OPTIONS` preflight. A preflight with a valid `Origin` returns `204` with CORS headers, and one without returns `403` `ORIGIN_REJECTED`.

## Success responses

| Status | Meaning |
| --- | --- |
| `202 Accepted` | Every Event was durably written to Kafka. The body is `{"accepted": N, "rejected": []}` |
| `207 Multi-Status` | The Envelope was valid but some Events were not. `rejected` lists each one as `{"eventId", "code"}`, where `code` is `INVALID_EVENT`. The valid Events were accepted. If none were valid, `accepted` is `0` and nothing was queued |

A success means **Kafka has the Events**, not that they are queryable. See [Event pipeline](/docs/self-hosting/event-pipeline/).

**Storage pressure.** A `202` with `accepted: 0` and the header `X-OpenRUM-Storage-Pressure: hard-stop` means the Instance is refusing to store data because ClickHouse reached its hard-stop threshold. It is deliberately a success so browsers drain their queues instead of retrying. See [Storage pressure](/docs/self-hosting/storage-pressure/).

## Error responses

Errors use a JSON body:

```json
{
  "error": {
    "code": "INVALID_KEY",
    "message": "The project key is invalid or revoked.",
    "requestId": "..."
  }
}
```

Quote `requestId` when you report a problem. It is also sent as `X-Request-ID`.

| Status | `error.code` | Cause | Retry? |
| --- | --- | --- | --- |
| `400` | `INVALID_BODY` | The request body could not be read | No |
| `400` | `INVALID_COMPRESSION` | The `gzip` body is corrupt | No |
| `400` | `INVALID_ENVELOPE` | The Envelope does not match the schema, or has 0 or more than 100 Events | No |
| `400` | `ENVIRONMENT_MISMATCH` | The Envelope's Environment is not registered for the Project | No, fix the Project settings or the SDK `environment` |
| `401` | `INVALID_KEY` | The key is missing, repeated, unknown or revoked | No |
| `403` | `ORIGIN_REJECTED` | The request `Origin` is not allowed for the Project | No, add the Origin in Project settings |
| `413` | `PAYLOAD_TOO_LARGE` | The body exceeds a size limit or the decompression ratio | No |
| `415` | `UNSUPPORTED_ENCODING` | `Content-Encoding` is something other than `gzip` | No |
| `415` | `UNSUPPORTED_MEDIA_TYPE` | `Content-Type` is not `application/json` | No |
| `429` | `RATE_LIMITED` | A per-IP or Project limit was exceeded | Yes, after `Retry-After` |
| `503` | `INGEST_UNAVAILABLE` | Kafka did not durably accept the write | Yes, after `Retry-After` |

### 429 headers

A `429` carries three headers:

| Header | Value |
| --- | --- |
| `Retry-After` | `1` (seconds) |
| `X-OpenRUM-RateLimit-Scope` | `ip` or `project` |
| `X-OpenRUM-RateLimit-Limit` | The ceiling that rejected the request, in requests per second |

The default ceilings are 1,000 requests per second per IP and 5,000 per Project. How to change them, and how to diagnose a sustained `429`, is on [Rate limits](/docs/product/rate-limits/).

## What the Browser SDK does

| Response | SDK behavior |
| --- | --- |
| `2xx` | The batch is removed from the queue |
| `401`, `403` | Treated as permanent: the SDK clears its queue and stops sending until the SDK is initialized again |
| `429`, `5xx`, or no response | The batch stays queued and is retried. `Retry-After` is honored up to 60 seconds, otherwise it backs off exponentially with jitter up to 60 seconds |
| Any other `4xx` | The batch is dropped, since sending it again would fail the same way |

If a single Event is too large to fit in a request on its own, the SDK drops it rather than blocking the queue.

## Troubleshooting by status

| You see | Check first |
| --- | --- |
| `401` right after setup | The write key in the SDK matches a key that is still active under the Project's settings |
| `403` only from some pages | The Origin list. Scheme, host and port must all match, and paths are not allowed |
| `400` `ENVIRONMENT_MISMATCH` | The `environment` option against the Environments registered for the Project |
| `413` | Very large attributes, breadcrumbs or stack traces; reduce what you send |
| Repeated `429` | `X-OpenRUM-RateLimit-Scope` first, then [Rate limits](/docs/product/rate-limits/) |
| `503` | Kafka health; see the [Kafka runbook](/docs/self-hosting/kafka/) |
| `202` but nothing in the Console | [Event pipeline](/docs/self-hosting/event-pipeline/), starting with Consumer lag and filters |
