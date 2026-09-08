# OpenRUM

OpenRUM is an open-source, self-hosted frontend monitoring platform that helps you **understand user behavior** and **quickly identify, diagnose, and resolve production issues**.

The Alpha includes:

- PV, UV, acquisition, country, device and browser analysis
- Governed custom events, funnels, bounded paths and weekly retention
- JavaScript errors grouped into Issues, session context and Source Map stack mapping
- Core Web Vitals, route performance and API request monitoring
- Evidence-backed insights, alerts, project settings and light/dark themes
- A privacy-bounded browser SDK that does not collect raw input values

## Run the Alpha locally

Docker is the only runtime prerequisite:

```sh
docker compose --env-file deploy/compose/.env.example -f deploy/compose/docker-compose.yml up -d --build
```

Open [http://127.0.0.1:4173](http://127.0.0.1:4173) and sign in with:

```text
demo@openrum.local
OpenRUM-demo-2026!
```

The first start migrates both databases and loads a deterministic ecommerce demo with 30,000 sessions across behavior, performance, API and error monitoring. Object storage is optional. See the [quickstart](docs/quickstart.md) for verification and troubleshooting.

Developing from source instead? `pnpm openrum dev` runs the API and console from source against containerised infrastructure, and `pnpm openrum up` runs everything in containers. Both wait for readiness and report the whole stack in one table; see [Local development](docs/local-development.md).

## Architecture

- React, TypeScript, Vite and shadcn/ui for the console
- TypeScript browser SDK and Vite Source Map plugin
- Go API, ingest, consumer and background worker services
- PostgreSQL for control-plane state
- ClickHouse for event and aggregate queries
- Kafka for ingestion buffering and Redis for quotas/state
- Optional Alibaba OSS or S3-compatible storage for Source Map artifacts and future large objects

The included Compose topology is for local Alpha evaluation, not production high availability. Production deployment requires TLS, secret management, backups, replicated dependencies, observability and capacity planning.

## Develop

Read the [local development guide](docs/local-development.md), [contributor guide](docs/contributing.md), [demo data guide](docs/demo-data.md), [system administration plan](docs/system-administration.md), and [product roadmap](docs/product-roadmap.md). The runnable SDK example lives in [examples/react-vite](examples/react-vite).

OpenRUM is under active Alpha development. Expect schema and API changes before the first stable release.

## Public website and documentation

The static Astro/Starlight site is independent of the API and console:

```sh
pnpm site:dev
pnpm site:build
pnpm site:check
```

Its two adoption paths are the local [Quickstart](docs/quickstart.md) and the source repository. The release target is `openrum.dev`, but this README does not imply that DNS or a public GitHub repository is live until the external launch checks have passed. There is no hosted Demo, SaaS signup or pricing flow in the self-hosted Alpha.
