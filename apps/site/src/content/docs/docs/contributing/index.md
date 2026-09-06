---
title: Contributing
description: How to develop, test and propose changes to OpenRUM.
---

OpenRUM welcomes focused contributions that improve the Alpha product, documentation and operational safety.

## Toolchain

- Node.js 24, corepack and pnpm 11
- Go version from `go.mod`
- Docker with Compose v2

```sh
corepack enable
pnpm install --frozen-lockfile
```

Follow [Local development](/docs/contributing/local-development/) for dependency startup, Vite proxy and common commands. Demo fixtures are documented in [Deterministic Demo data](/docs/getting-started/demo-data/).

## Repository map

| Path | Purpose |
| --- | --- |
| `apps/web` | React Console |
| `apps/site` | Public website and documentation |
| `packages/browser-sdk` | Privacy-bounded Browser SDK |
| `packages/protocol` | Event contract |
| `packages/vite-plugin` | Source Map upload |
| `services` | Go API, ingest, consumer, worker |
| `internal` | Shared domain and infrastructure |
| `migrations` | PostgreSQL and ClickHouse migrations |
| `tests/e2e` | Playwright product journeys |

## Before opening a change

```sh
pnpm run check
pnpm exec playwright test
docker compose --env-file deploy/compose/.env.example -f deploy/compose/docker-compose.yml config --quiet
```

Add focused Go/React tests for changed behavior. Product journeys belong in Playwright. Migrations are forward-only and must preserve documented retention policy.

## Product and privacy constraints

- Never collect raw form values, passwords, authorization headers, cookies or unbounded URLs.
- Normalize routes and API URLs before persistence.
- Keep terminology aligned with [Domain model](/docs/concepts/domain-model/) and root `CONTEXT.md`.
- Insights must link to inspectable evidence.
- Maintain keyboard navigation, visible focus, responsive layouts and both color themes.

Keep pull requests scoped. Include motivation, schema/API changes, screenshots for UI work, privacy effects and exact verification commands. Roadmap context lives in `docs/product-roadmap.md`. Instance-level operator boundaries are documented in [System administration](/docs/contributing/system-administration/).
