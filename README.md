<p align="center">
  <img src="apps/site/public/favicon.svg" width="72" height="72" alt="OpenRUM signal monster" />
</p>

<h1 align="center">OpenRUM</h1>

<p align="center">
  Open-source frontend monitoring, on your infrastructure.<br />
  Connect errors, performance, logs and user journeys in one place.
</p>

<p align="center">
  <a href="https://openrum.netlify.app/">Website</a> ·
  <a href="https://openrum.netlify.app/docs/introduction/">Documentation</a> ·
  <a href="#quickstart">Quickstart</a> ·
  <a href="https://github.com/open-rum/openrum/issues">Report an issue</a>
</p>

<p align="center">
  <a href="https://github.com/open-rum/openrum/actions/workflows/ci.yml"><img src="https://github.com/open-rum/openrum/actions/workflows/ci.yml/badge.svg" alt="CI status" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT License" /></a>
  <img src="https://img.shields.io/badge/status-Alpha-ffb020" alt="Alpha" />
</p>

<p align="center"><strong>English</strong> · <a href="README.zh-CN.md">简体中文</a></p>

OpenRUM is a self-hosted real user monitoring (RUM) platform for web products. Start with an error, a slow request or a drop in conversion, then use the related Session and Events to investigate what happened. Your telemetry stays in the infrastructure you operate.

**Alpha:** OpenRUM is under active development. Expect schema and API changes before the first stable release.

## What you can do

| Area                         | Capabilities                                                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **Errors and investigation** | Group JavaScript errors into Issues, map stack frames with Source Maps, and inspect the surrounding Session timeline.    |
| **Performance and APIs**     | Track Core Web Vitals, route performance, request latency and API failures.                                              |
| **Product analytics**        | Explore Page Views, visitors, acquisition, devices and browsers; analyze Custom Events, funnels, paths and retention.    |
| **Logs**                     | Search structured browser logs by severity, user or Session, and follow them into related observations.                  |
| **Dashboards and alerts**    | Build project dashboards, configure metric alerts, and deliver notifications through Feishu/Lark or Webhook.             |
| **Team access**              | Manage Organizations and roles; enable Google, GitHub, LDAP or multiple OIDC providers alongside local password sign-in. |

The Browser SDK omits raw input values, request/response bodies and headers from automatic capture. URLs are normalized and sensitive values are scrubbed. See the [privacy guide](https://openrum.netlify.app/docs/self-hosting/security/privacy/) for the capture boundaries.

## Quickstart

You need **Git**, **Docker with Compose v2**, and at least **8 GB of memory available to Docker**.

```sh
git clone https://github.com/open-rum/openrum.git
cd openrum

docker compose --env-file deploy/compose/.env.example \
  -f deploy/compose/docker-compose.yml up -d --build
```

The first start builds the services and applies database migrations. Wait for the long-running services to become healthy:

```sh
docker compose --env-file deploy/compose/.env.example \
  -f deploy/compose/docker-compose.yml ps
```

Then load the demo, a repeatable ecommerce dataset with approximately **30,000 Sessions across 14 days**. It is optional and safe to run again:

```sh
docker compose --profile seed --env-file deploy/compose/.env.example \
  -f deploy/compose/docker-compose.yml run --rm --no-deps demo-seed
```

If you work from a clone with Go installed, `pnpm openrum up` followed by `pnpm openrum seed` does the same. Open **[http://127.0.0.1:4173](http://127.0.0.1:4173)** and sign in:

| Email                | Password             |
| -------------------- | -------------------- |
| `demo@openrum.local` | `OpenRUM-demo-2026!` |

Explore the dashboards, errors, performance and Sessions using the demo data. Skip the seed step to start from an empty Instance and create your own owner on the first visit. Object storage is optional; enable it when you need to upload Source Map artifacts.

To stop the stack while keeping its data:

```sh
docker compose --env-file deploy/compose/.env.example \
  -f deploy/compose/docker-compose.yml down
```

This stack uses example credentials and single-node dependencies for local evaluation. For a real deployment, follow [single-host Docker](https://openrum.netlify.app/docs/self-hosting/docker-production/) or [Kubernetes / Helm](https://openrum.netlify.app/docs/getting-started/production-deployment/). For port conflicts or startup failures, see the [local quickstart troubleshooting](docs/quickstart.md#troubleshooting).

## Connect your first project

Create a Project in the Console, add your application's origin to its allowed origins, and copy the client DSN. For a local test page, the running Instance serves the Browser SDK directly:

```html
<script src="http://127.0.0.1:4173/api/v1/sdk/browser/0.1.0/openrum.min.js"></script>
<script>
  OpenRUM.init({
    dsn: "PASTE_YOUR_PROJECT_DSN",
    environment: "development",
  });
</script>
```

Replace the DSN with the value from your Project. For a deployed website, use your Instance's HTTPS SDK URL. See [Create your first project](https://openrum.netlify.app/docs/getting-started/create-first-project/) and the [Browser SDK guide](https://openrum.netlify.app/docs/sdk/browser/) for asynchronous loading, framework integration and verification. A runnable React + Vite example is available in [examples/react-vite](examples/react-vite).

## Documentation

| Task                               | Guide                                                                                                                                                                         |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Choose an installation path        | [Getting started](https://openrum.netlify.app/docs/introduction/)                                                                                               |
| Connect your frontend              | [Browser SDK](https://openrum.netlify.app/docs/sdk/browser/) · [Next.js](https://openrum.netlify.app/docs/sdk/browser/nextjs/) · [Astro](https://openrum.netlify.app/docs/sdk/browser/astro/) |
| Configure login                    | [Email, Google, GitHub, LDAP and OIDC (repository guide)](apps/site/src/content/docs/docs/getting-started/sign-in/index.mdx)                                                  |
| Deploy and operate an Instance     | [Self-hosting](https://openrum.netlify.app/docs/self-hosting/overview/) · [Backup and restore](https://openrum.netlify.app/docs/self-hosting/backup-restore/)                 |
| Upload Source Maps                 | [Source Map integration](https://openrum.netlify.app/docs/sdk/source-maps/)                                                                                                   |
| Configure services and SDK options | [Configuration reference](https://openrum.netlify.app/docs/reference/configuration/) · [SDK options](https://openrum.netlify.app/docs/reference/sdk-options/)                 |

## Architecture

The TypeScript Browser SDK sends Events through Go Ingest, Kafka and the Consumer into ClickHouse. The React Console queries those Events through the Go API.

| Component                             | Role                                                         |
| ------------------------------------- | ------------------------------------------------------------ |
| React, TypeScript, Vite and shadcn/ui | Console and project analysis                                 |
| Go API, Ingest, Consumer and Worker   | Authentication, event intake, processing and background jobs |
| ClickHouse                            | Events and analytical queries                                |
| PostgreSQL                            | Users, Projects and configuration                            |
| Kafka and Redis                       | Ingestion buffering, quotas and temporary state              |
| Optional OSS or S3-compatible storage | Source Map artifacts                                         |

Read the [architecture guide](https://openrum.netlify.app/docs/self-hosting/architecture/) for the full event path and dependency responsibilities.

## Develop and contribute

Source development requires **Node.js 24**, **pnpm 11.11**, **Go 1.26** and Docker. From the repository root:

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm openrum dev
```

This runs the API and Console from source, with infrastructure and pipeline services in containers. The Console stays at `http://127.0.0.1:4173`. See [local development](https://openrum.netlify.app/docs/contributing/local-development/) for service commands and troubleshooting.

Bug reports, documentation, tests and code are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md), discuss substantial changes in [GitHub Issues](https://github.com/open-rum/openrum/issues), and run `pnpm run check` before opening a pull request. For documentation changes, also run `pnpm site:check`.

Report vulnerabilities privately using the [security reporting guide](https://openrum.netlify.app/docs/self-hosting/security/vulnerability-reporting/).

## License

[MIT](LICENSE).
