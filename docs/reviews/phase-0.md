# Phase 0 review — Foundation & Local Pipeline

Reviewed: 2026-09-02

## Scope

Tasks 001–010: monorepo foundations, React/Go service shells, event protocol,
local dependencies, migrations, health/metrics, design-token boundary, and CI.
GitHub review was unavailable because this repository has no configured remote;
this document records the equivalent local review required by the roadmap.

## Verification evidence

- `pnpm run check` passes formatting, ESLint, TypeScript, workspace tests,
  protocol generation/fixtures, production builds, Go tests/vet, and SDK budget
  configuration.
- golangci-lint v2.12.2 reports zero issues with `.golangci.yml`.
- A deliberate unused TypeScript variable fails ESLint with a non-zero status.
- PostgreSQL and ClickHouse migrations apply from a fresh state and remain
  idempotent on a second run.
- PostgreSQL, ClickHouse, Kafka, Redis, and development object storage reach
  healthy state through Docker Compose.
- API, ingest, consumer, and worker expose successful `/health/live`,
  `/health/ready`, and `/metrics` responses against the running dependencies.
- With Redis redirected to an unreachable port, API liveness remains 200 and
  readiness becomes 503 without exposing connection details.
- All four service processes log the shutdown request and stop cleanly on an
  interrupt.

## Findings resolved during review

- Moved Compose PostgreSQL to host port 5433 after detecting an existing local
  PostgreSQL listener on 5432.
- Replaced unavailable container tags with registry-verified versions.
- Corrected `openrum_service_info` from the Gauge default of 0 to an explicit 1.
- Replaced deprecated Prometheus collectors and fixed unchecked close errors,
  missing request contexts, and frontend `any` types reported by linting.
- Aligned TypeScript to 6.0.3 because TypeScript 7 was outside the installed
  typescript-eslint peer range.

## Accepted follow-up risks

- The current frontend bundle warning (~1 MiB uncompressed) is tracked by the
  later performance-budget task; route-level code splitting is not part of the
  Phase 0 shell.
- Foundation readiness checks prove network reachability. When database,
  Kafka, Redis, and OSS clients become long-lived service dependencies, their
  protocol-level ping checks must replace the TCP probes.
- MinIO is strictly a local development substitute. Production object storage
  remains Alibaba Cloud OSS.

## Decision

Phase 0 is accepted for local continuation. Push, hosted CI execution, and a
GitHub PR remain unavailable until a remote is configured.
