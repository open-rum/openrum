# Contributor guide

## Toolchain

- Node.js 24, corepack and pnpm 11.11
- Go 1.26
- Docker with Compose v2

Run `corepack enable`, `pnpm install --frozen-lockfile`, and follow the [local development guide](local-development.md). It documents the Docker dependencies, host API environment, Vite proxy and common commands. See [demo data](demo-data.md) when working on generated fixtures.

## Repository map

- `apps/web`: React console and design system
- `packages/browser-sdk`: privacy-bounded browser SDK
- `packages/protocol`: generated and validated event contract
- `packages/vite-plugin`: Source Map upload integration
- `services`: Go API, ingest, consumer and worker entrypoints
- `internal`: shared domain, query, migration and infrastructure packages
- `migrations`: PostgreSQL and ClickHouse migrations
- `tests/e2e`: Playwright product journeys

PostgreSQL owns users, organizations, projects, keys, releases and workflow state. ClickHouse owns immutable RUM events and query aggregates. Kafka separates acceptance from storage; Redis supports limits and short-lived state; object storage contains Source Maps.

## Before opening a change

```sh
pnpm run check
pnpm exec playwright test
docker compose --env-file deploy/compose/.env.example -f deploy/compose/docker-compose.yml config --quiet
```

Add focused Go/React tests for changed behavior. Product journeys belong in Playwright. New migrations are forward-only, ordered, repeatable in a fresh database and must preserve the documented retention policy.

## Product and privacy constraints

- Never collect raw form values, passwords, authorization headers, cookies or unbounded URLs.
- Normalize routes and API URLs before persistence.
- Behavior queries must retain explicit time, row, depth and cardinality budgets.
- Do not imply cross-device identity resolution; current funnels use sessions and retention uses anonymous visitor IDs.
- Insights must link to inspectable evidence and may not present an unexplained score.
- Maintain keyboard navigation, visible focus, responsive layouts and both color themes.

Keep PRs scoped to a roadmap task. Include motivation, schema/API changes, screenshots for UI work, privacy effects and exact verification commands.
