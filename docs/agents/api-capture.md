# API header and body capture code map

<!-- cspell:ignore apikey accesskey passwd forwardedfor realip clientip xsrf passphrase creditcard cardnumber cvv -->

Read this file before changing which HTTP headers or bodies an API Request may
carry, the capture rules and their Console page, the SDK's header and body
reading, or how long stored headers and bodies live.

## Stable product rules

- Capture is **off by default and per API**. A Project with no rule reads no
  header or body in the browser and stores none on the server. Cookies are never
  captured. Bodies are a separate opt-in from headers (`requestBody` and
  `responseBody` on a rule) and each direction is chosen on its own.
- The **Consumer is the authority**. A write key is public, so an event can carry
  any header for any endpoint; `applyAPICapture` keeps a header only when a rule
  names it for that method and endpoint. With no provider or no rules it clears
  everything. The SDK only avoids reading and uploading what would be dropped.
- Rules match the **normalized endpoint** the API monitoring page shows, after the
  Project's URL rules have run. The browser holds the concrete address, so
  `capture.Settings.ClientProjection` widens each `:id` to `*`; the SDK then matches
  a superset and the Consumer still decides. Do not re-implement URL normalization
  in the browser.
- **Credential and client-address names are refused**, never configurable: a
  name containing `auth`, `cookie`, `token`, `secret`, `password`, `passwd`,
  `apikey`, `accesskey`, `session`, `csrf`, `xsrf`, `signature`, `credential`,
  `forwardedfor`, `realip`, `clientip`, `email` or `phone` (case and separators
  ignored).
- An unreadable rule document means **no rules** in the SDK. This is the reverse of
  inbound filters on purpose: stale capture rules keep reading headers a Project
  switched off.
- Bodies are the most sensitive thing collected. The SDK reads only text, JSON and
  form bodies; never `FormData`, `Blob`, buffers or streams. A body over 64 KB is
  stored as the `[omitted: ...]` marker, never cut, because JSON must be complete to
  be redacted by key. A body that is kept is redacted by key and by pattern, then cut
  to 4 KB with a `…[truncated]` marker. Redaction runs in the browser and again in
  normalization, so it must stay idempotent; the Consumer then keeps only the
  directions a rule opted in. Free text cannot be fully cleaned and the docs say so.
- Stored headers and bodies are cleared **3 days** after the request, shorter than
  the row's retention, and are visible to every Project member.

## Values that must stay in step

| Value | Where it lives |
| --- | --- |
| Retention of 3 days | `capture.RetentionDays` (query cut in `internal/query/apis.go`), the column TTLs in `migrations/clickhouse/0010_api_request_headers.up.sql` and `0011_api_bodies.up.sql`, `HEADER_RETENTION_DAYS` in `apps/web/src/lib/api/apiCapture.ts`, and the public docs |
| Sensitive name fragments | `internal/privacy/headers.go` and `packages/browser-sdk/src/capture.ts`; both tests list the same names |
| Sensitive body keys | `internal/privacy/body.go` and `packages/browser-sdk/src/body.ts`; both tests list the same names. `auth` alone is deliberately absent, because it would redact `author` |
| Body limits (4 KB kept, 64 KB read, the two markers) | `internal/privacy/body.go`, `packages/browser-sdk/src/body.ts`, `bodyView` in `apps/web/src/features/apis/sampleFormat.ts`, and the `request_body`/`response_body` limit in the protocol schema (looser, so a long body is cut rather than rejected) |
| Limits (20 headers, 256-byte values, 64-byte names) | `internal/privacy/headers.go`, `packages/browser-sdk/src/capture.ts`, and the `headers` definition in `packages/protocol/schema/envelope-v1.json` (which is deliberately looser: the Consumer truncates instead of rejecting the whole envelope) |

ClickHouse applies a column TTL during merges, not when it expires, so the
samples query also hides snapshots older than the window. Keep that cut.

## Change map

| Concern | Primary files |
| --- | --- |
| Rules, validation, matching, browser projection | `internal/capture/capture.go` |
| Header scrubbing and the refused names | `internal/privacy/headers.go` |
| Body redaction (JSON by structure, form fields, loose-text fallback) | `internal/privacy/body.go` |
| Protocol and canonical event | `packages/protocol/schema/envelope-v1.json`, `internal/event/normalize.go` |
| Consumer gate and rule cache | `services/consumer/internal/capture.go`, `consume.go` |
| Storage | `migrations/postgres/0029_*`, `migrations/clickhouse/0010_*`, `0011_*`, `services/consumer/internal/clickhouse_writer.go` |
| Rule persistence and audit | `internal/metadata/project_capture.go` |
| Console API and SDK configuration | `services/api/internal/handlers/project_capture.go`, `sdk_config.go` |
| Browser SDK | `packages/browser-sdk/src/capture.ts`, `body.ts`, `integrations/fetch.ts`, `integrations/xhr.ts`, `config.ts` |
| Reading headers back | `internal/query/apis.go` (`Samples`) |
| Console | `apps/web/src/features/settings/ProjectAPICapturePage.tsx`, `apps/web/src/features/apis/ApiSamples.tsx` |
| Public documentation | `product/api-monitoring`, `product/project-settings`, `self-hosting/security/privacy`, in both languages |

## Verification

Run `go test ./internal/capture ./internal/privacy ./internal/event ./services/consumer/...`,
the SDK tests in `packages/browser-sdk`, and the web tests for the settings page and
`ApiSamples`. With `TEST_POSTGRES_DSN` and `TEST_CLICKHOUSE_DSN` set to `*_test`
databases, also run the `integration`-tagged tests in `internal/metadata`,
`internal/query` and `services/consumer/internal`. For the whole path, enable a rule
in the Console, load the built SDK on an allowed origin, and read
`api_request_headers`, `api_response_headers`, `api_request_body` and `api_response_body`
from `rum_events`; then post a forged envelope straight to Ingest, with credentials in the
bodies, and confirm only what the rule names was stored and it came back redacted.
