# Development data generator

The generator synthesizes traffic for a project on demand, so a query or a page
under development has something realistic to run against. It is reachable from
the console's bottom-right floating flask icon **造数据** (a quick-entry Dialog available from
any Console page), the legacy `/projects/{id}/dev-data` route, and over the API at
`POST /api/v1/projects/{id}/dev-data`.

This is separate from the [demo data generator](demo-data.md). The demo
generator seeds one large fixed dataset at startup by writing ClickHouse
directly. This one produces small datasets repeatedly while you work, and sends
them through the real ingest endpoint.

## Why it posts to ingest instead of writing ClickHouse

Every generated envelope travels the same path as production traffic: schema
validation at the ingest endpoint, then Kafka, then the consumer, which performs
URL normalization, route templating, error fingerprinting, sampling arithmetic
and the materialized-view rollups.

That uses the Project's default client DSN and a few seconds of consumer lag. In exchange, data
generated here cannot disagree with production data about the shape of a row. A
generator that wrote ClickHouse directly could produce combinations the pipeline
never emits, and a query validated against those would be wrong in production.
The demo generator does write directly, which is why it can fabricate a country
distribution the live pipeline could not produce before geo resolution existed.

## Availability

The surface exists only in development, and it is absent rather than merely
guarded elsewhere:

- `NewDevDataHandler` returns `nil` unless `APP_ENV=development`, and `nil`
  registers no routes.
- The console route and its lazy-loaded quick entry are declared inside an
  `import.meta.env.DEV` branch, so a production bundle contains no reference to
  the page.

Callers still need a session and the `project.test-event.send` permission, which
owners, admins and members hold.

## The client DSN

The API looks up the current default public key for the selected Project on each
run. No manual DSN or browser-stored credential is needed. Old globally stored
DSNs are ignored, avoiding stale keys and accidental cross-project writes.
API clients may still supply `writeKey`, but it must be an active public key
belonging to the requested Project. A stopped Project cannot generate data.

## Quick workflow

1. Open **造数据** using the bottom-right floating flask icon without leaving the current page.
2. Confirm the Project, write Environment and data window. The current analysis
   range and specific Environment are selected by default; “all environments”
   falls back to the Project's default Environment for writes.
3. Choose a preset and session count: 100 for a quick check, 300 for fuller
   charts, up to 5,000. Large runs are synchronous and can take time; start small.
4. Generate. The form locks during delivery to prevent duplicate submissions.
5. Inspect accepted/rejected/failed/unsent counts. The Console checks a unique
   session sample every two seconds for up to roughly 30 seconds, then refreshes
   Project queries once the sample is queryable. This proves sample availability,
   not that every event was stored. Use **检查入库并刷新** to check again.
6. **按生成范围查看大盘** opens the exact returned time range and Environment.
   Other per-page filters are not automatically cleared on the underlying page.

### Localhost filtering pitfall

The previous generator used the first allowed Origin for both the request header
and simulated page URLs. If that Origin was `http://127.0.0.1:4173` and the
Project enforced the localhost inbound filter, Ingest accepted every event but
the Consumer discarded them all. A 202 response alone never proved storage.

The generator now keeps these separate: the transport `Origin` remains allowed
by the Project, while a local simulated page origin becomes
`https://shop.example.com`. This models a deployed test site without disabling
inbound filters. Advanced JSON can deliberately supply local page URLs to test
filtering. All other filters, rate limits, and storage-pressure guards still apply.

## Presets

The `logs` preset (**结构化应用日志**) generates trace/debug/info/warn/error/fatal logs with payment attributes and Session/Trace context. Use it to validate the Logs explorer after deploying ClickHouse migration `0008_logs` and updated ingest/consumer services.

| Preset            | What it is for                                                                                                         |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `storefront`      | A broad mix across browse and checkout: page views, vitals, a wide API surface, errors and funnel events. The default. |
| `api-surface`     | Every endpoint in one journey, including the planted browser and release regressions.                                  |
| `failing-release` | Checkout only, where the newest release fails far more often.                                                          |
| `web-vitals`      | Page views and vitals only, spread across all three rating bands.                                                      |
| `error-burst`     | A narrow window dominated by a few recurring exceptions, for issue grouping.                                           |

Presets deliberately plant findings rather than only producing volume:

- `GET /api/products/:id/recommendations` is roughly 3.4× slower on Safari
  desktop and 3.8× on Safari mobile, so the API dimension drill-down has a
  browser regression to surface.
- `POST /api/payments/intent` fails far more often on `web@2026.09.3` than on
  its predecessors, so period and release comparisons have something to catch.
- `POST /api/admin/inventory/export` fires on 1% of checkout sessions, so it
  stays under the 75-sample threshold and renders as insufficient data instead
  of a confident but meaningless percentile.
- 4xx responses carry no `failure` flag while 5xx responses carry `http`, which
  matches how the browser SDK classifies outcomes. A 401 therefore raises the
  client-error count without moving the failure rate.
- Latency and response size are drawn independently, so "slow because large" is
  a question the data can actually answer.

## Time windows

Sessions are spread evenly across the chosen window rather than clustered at one
instant, which is what gives per-minute rollups and trend charts a shape.
The API accepts explicit `from`/`to` (both required together) and `environment`,
or `minutes` ending at request time. Windows are bounded to the last 30 days.
Journey tails are fitted into the selected window so events do not leak into
the future or past the dashboard's end time. UI time and Environment selections
override the corresponding fields in advanced JSON.

Backdating is safe. The pipeline rewrites a timestamp only when it is
implausible — before the year 2000, or more than 24 hours in the future — and
flags those with `clock_adjusted`. A timestamp in the past is accepted as sent.
Note that raw events carry a 14-day TTL, so a window wider than that produces
rows that are already eligible for deletion.

## Editing the full scenario

The console's **编辑完整场景 JSON** checkbox exposes the whole `Scenario`, which
is the same structure the API accepts. Its shape:

```jsonc
{
  "seed": 1757030400000000000, // the same seed replays the same dataset
  "environment": "production", // overridden by the selected write environment
  "baseUrl": "https://shop.example.com", // simulated page origin, not transport Origin
  "sessions": 300,
  "from": "2026-09-04T12:00:00Z",
  "to": "2026-09-05T12:00:00Z",
  "releases": [{ "value": "web@2026.09.3", "weight": 35 }],
  "clients": [
    {
      "name": "safari-mobile", // referenced by an api's slowClients
      "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) ...",
      "country": "JP",
      "weight": 16,
    },
  ],
  "journeys": [
    {
      "name": "checkout",
      "weight": 35,
      "pages": [
        {
          "route": "/products/:id", // the normalized template
          "path": "/products/8f3a-runner-pro", // the concrete URL
          "title": "Runner Pro",
          "vitals": [{ "name": "LCP", "odds": 1, "value": { "min": 900, "max": 4800 } }],
          "apis": [
            {
              "method": "GET",
              "path": "/api/products/8f3a-runner-pro",
              "odds": 1,
              "repeat": { "min": 1, "max": 3 },
              "latencyMs": { "min": 35, "max": 210 },
              "transferSize": { "min": 6000, "max": 24000 },
              "outcomes": [
                { "value": "200", "weight": 975 },
                { "value": "404", "weight": 15 },
                { "value": "500", "weight": 10 },
                { "value": "0:network", "weight": 5 },
              ],
              "slowClients": { "safari-mobile": 3.8 },
              "failingReleases": {
                "web@2026.09.3": [{ "value": "500", "weight": 140 }],
              },
            },
          ],
          "errors": [{ "name": "TypeError", "message": "...", "stack": "...", "odds": 0.04 }],
          "custom": [{ "name": "add_to_cart", "odds": 0.35, "measurements": { "price": 129.9 } }],
        },
      ],
    },
  ],
}
```

Points worth knowing when authoring one:

- **Outcomes** are written as `status` or `status:failure`, for example `200`,
  `404`, `0:network`, `0:timeout`, `0:abort`. A status of 500 or above gets the
  `http` failure automatically. A transport failure clears the status and omits
  the transfer size, because no response was delivered.
- **`odds`** is the probability the item occurs on a given page visit, so a
  value of `0.01` is how a low-volume endpoint is created.
- **Vital ratings** are computed from the value using the published Core Web
  Vitals thresholds. A scenario cannot state a value and a contradictory rating.
- **`environment`** must be one of the Project's registered Environments.
  **`baseUrl`** in advanced JSON controls simulated pages; it is intentionally
  independent of the transport Origin, which always comes from the allowlist.
- **Weights** need no particular scale; they are summed and compared against a
  draw. Omitting every weight in a list makes the draw uniform.
- **Validation reports every problem at once**, because the scenario is usually
  hand-edited and fixing one error per round trip is slow.
- **Determinism**: a given seed and scenario always produce the same measured
  shape — same client, endpoint, latency and outcome per event. Only the
  identifiers differ between runs.

The cap is 5,000 sessions per request. The generator buffers every envelope
before sending, and a development machine should not be asked to hold more.

## Browser, device and country

None of these travel inside the envelope, so the generator sets them per
request:

- Browser, browser version, OS, OS version and device type are parsed from the
  `User-Agent` header.
- Country is read from the trusted country header, `CF-IPCountry` by default.

Country resolution needs configuration, and it is off unless you provide it:

| Variable              | Meaning                                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `GEO_COUNTRY_HEADER`  | The header carrying the country, injected by the edge proxy. Unset disables resolution and every event stores `ZZ`. |
| `GEO_TRUSTED_PROXIES` | CIDRs or addresses whose forwarded country header is believed. Required when the header is set.                     |

The trust boundary is not optional. The ingest rate limiter identifies callers
by their socket peer address precisely because that cannot be forged; a country
read from a header can be. Honouring the header only for requests arriving from
a declared proxy keeps the forgeable value out of anything security-relevant —
country is used for analytics and nothing else.

The bundled compose file sets both, trusting the compose network because the
bundled nginx is the proxy there. **A real deployment must narrow
`GEO_TRUSTED_PROXIES` to its own edge and have that edge overwrite the header
rather than pass a client-supplied one through.**

One exception exists, and it is bounded by `APP_ENV` rather than by the trust
list. When `APP_ENV` is `development`, ingest reads the country header from any
peer. A development stack has no edge to declare, and the peer address is not
evidence of one either: a request from the host to a published container port
arrives from an address that varies by platform, so it falls outside the private
ranges on Docker Desktop and inside them on Linux. Deciding trust by address
would therefore resolve countries for some contributors and not others. A
deployment never sets `APP_ENV` to `development`, and what a forged header can
reach is analytics and nothing else, because the rate-limit identity stays bound
to the socket peer address.

## Where it sends

`INGEST_BASE_URL` selects the target. Compose sets it to
`http://ingest:8081/ingest`, reached container to container, because the public
origin would resolve to the container's own loopback.

Running the API on the host, point it at ingest's own published port:

```sh
INGEST_BASE_URL=http://127.0.0.1:8081/ingest
```

`openrum dev` derives exactly this, so there is nothing to set by hand. Going
straight to ingest rather than through the bundled proxy costs nothing here: the
country comes from the header the generator writes, and a development stack
believes that header whatever the peer address is.

When `INGEST_BASE_URL` is unset it falls back to `PUBLIC_BASE_URL` + `/ingest`,
which works because both the bundled proxy and the Vite dev server route
`/ingest/` onwards.

## After a run

The response reports what ingest accepted, what it rejected per event, how many
batches failed outright, and the event breakdown by type. Events are queryable
once the consumer has written them, usually within a few seconds — the response
is `202`, not a promise that a query will already return them.

A non-zero rejected count means individual events failed schema validation; a
non-zero failed count means whole envelopes were refused, most often because the
DSN is wrong, the origin is not in the project's allowlist, or the
scenario's environment does not match the project's.

Delivery stops at the first failed batch and returns the counts already accepted,
the last failure, and remaining unsent batches. There is no automatic replay.
An Ingest hard-stop response is explicitly reported as a storage failure, not as
successful generation. If the sample never becomes queryable, check Consumer
health, inbound filters, and retention before generating another batch.

## Agent code map and regression checks

| Concern                                                      | Code                                                     |
| ------------------------------------------------------------ | -------------------------------------------------------- |
| Floating entry, form, sample polling, query refresh          | `apps/web/src/features/devdata/DevDataPage.tsx`          |
| Development-only floating entry integration                  | `apps/web/src/app/App.tsx`, `AppShell.tsx`               |
| Typed request/result                                         | `apps/web/src/lib/api/devData.ts`                        |
| Permission, default key, environment/window checks, delivery | `services/api/internal/handlers/dev_data.go`             |
| Scenario generation and bounded journey timestamps           | `internal/devdata/build.go`, `presets.go`, `scenario.go` |
| Local page filtering (do not disable for fixtures)           | `internal/filter/filter.go`                              |

Run `go test ./internal/devdata ./services/api/internal/handlers` and
`pnpm --filter @openrum/web exec vitest run src/features/devdata/DevDataPage.test.tsx`.
For a real smoke test, use a small active local Project, verify accepted events
are queryable and visible in the returned dashboard scope, and confirm the
default DSN, filters and disabled-project protection remain unchanged.
