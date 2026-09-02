# Phase 2 review — Browser SDK & Durable Ingestion

Reviewed: 2026-09-02

## Scope

Tasks 020–031: ClickHouse raw schema, browser SDK lifecycle and automatic
instrumentation, Web Vitals, fetch/XHR monitoring, custom reporting and privacy,
sampling, persistent transport, Ingest validation, Kafka durability, partial
acceptance, Consumer normalization and scrub, DLQ, ClickHouse batching, metrics,
React example, and pipeline load verification. GitHub review was unavailable
because this repository has no configured remote; this document records the
equivalent local review required by the roadmap.

## Verification evidence

- `pnpm run check` passes formatting, ESLint, TypeScript, 28 browser SDK tests,
  all Go unit tests, protocol regeneration/fixtures, production builds, and the
  30 KiB gzip SDK budget (10,612 bytes measured).
- golangci-lint v2.12.2 reports zero issues; race tests pass for Ingest,
  normalization, Consumer, metrics, and the buffered ClickHouse writer.
- All PostgreSQL, ClickHouse, Kafka, API, Ingest, and Consumer integration tests
  pass serially against dedicated local test stores.
- Ingest fuzzing executed over 30,000 generated inputs without a panic or 5xx;
  raw, compressed, compression-ratio, and decompression-bomb limits pass.
- A real Kafka 4.1 broker verifies synchronous `RequireAll` acknowledgement,
  disabled auto-topic creation, project/session partition keys, and successful
  retry after broker failure.
- A real Kafka → Consumer → ClickHouse integration stores Page View, Error, Web
  Vital, API Request, and Custom Event data with no missing Event IDs.
- A 30-second local k6 run sustained 9,998 accepted Events/s (300,100 Events):
  zero failed requests, Ingest P95 16.55ms, 300,100 ClickHouse rows and 300,100
  unique Event IDs, Kafka lag 73ms, and query freshness 101ms at measurement.
- The React/Vite example type-checks and builds, exposing controls that generate
  all five Event categories through the production SDK entry point.

## Findings resolved during review

- Added a bounded, persistent SDK queue with low-priority-first eviction and
  changed flush scheduling so steady event traffic cannot starve transmission.
- Corrected the SDK size gate to measure gzip output rather than raw JavaScript.
- Added negative and positive project-key caching with concurrent miss collapse,
  while never caching transient PostgreSQL failures.
- Enforced exact Origin matching, duplicate-header rejection, IP/project rate
  limits, bounded public errors, and guarded identity/gzip decompression.
- Implemented 207 sibling isolation: invalid Events are identified without
  preventing valid siblings from receiving a Kafka durability acknowledgement.
- Ensured Consumer retries the same fetched Kafka message before fetching the
  next one, preventing an offset gap from being committed after a sink failure.
- Removed raw payloads from DLQ records; only bounded location, reason, size, and
  SHA-256 diagnostic metadata remain.
- Added server-side URL/query removal, dynamic-ID normalization, PII/token/card
  scrubbing, and browser/OS/device enrichment before ClickHouse.
- Reduced the ClickHouse flush interval from 100ms to 10ms after the first load
  run exposed accumulating lag at about 4.7k Events/s; the repeated 10k run had
  no backlog.
- Switched the raw table to ReplicatedReplacingMergeTree and documented exact
  `FINAL`/Event-ID query semantics so redelivery after a crash converges rather
  than permanently inflating data.
- Added PostgreSQL to Ingest readiness because key validation depends on it.

## Accepted follow-up risks

- Country remains `ZZ` until the deployment supplies a trusted GeoIP source;
  country enrichment must be completed before dimensional analytics is accepted.
- Browser/device parsing currently uses User-Agent. Client Hints support can be
  added without changing the canonical ClickHouse columns.
- Exact queries over replacing data require `FINAL` or Event-ID-aware
  aggregation. Phase 3 materialized views and query repositories must preserve
  this rule.
- The web console bundle remains above its later 250 KiB gzip target; route and
  chart splitting is scheduled with the dedicated performance budget task.

## Decision

Phase 2 is accepted for local continuation. Push, hosted CI execution, and a
GitHub PR remain unavailable until a remote is configured.
