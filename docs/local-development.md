# Local development

This guide is for developing OpenRUM from source. If you only want to evaluate the product, use the Docker-only flow in the [quickstart](quickstart.md).

## Toolchain

- Docker Engine or Docker Desktop with Compose v2 and at least 8 GB of memory
- Node.js 24, Corepack and pnpm 11.11
- Go 1.26

From the repository root, prepare the JavaScript workspace:

```sh
corepack enable
pnpm install --frozen-lockfile
```

## Recommended development workflow

Run the stack through `openrum`, which manages the containers and the host processes together:

```sh
pnpm openrum dev
```

`dev` keeps the infrastructure and pipeline services in Docker and runs the API and the console from source, which gives frontend hot reload and fast Go restarts without a locally installed PostgreSQL, ClickHouse, Kafka or Redis. The command builds the images, applies migrations, loads the demo dataset, waits until every healthcheck passes, starts the API and the dev server, waits for those too, and then reports where everything is:

```text
mode dev, environment deploy/compose/.env.example

SERVICE     WHERE      STATE    DETAIL
postgres    container  ready    127.0.0.1:5433
clickhouse  container  ready    127.0.0.1:9000
kafka       container  ready    127.0.0.1:9092
redis       container  ready    127.0.0.1:6379
ingest      container  ready    127.0.0.1:8081
consumer    container  ready
worker      container  ready
api         host       ready    pid 22424, 127.0.0.1:8080
web         host       running  http://127.0.0.1:4173
```

Open `http://127.0.0.1:4173`. To run the product the way a deployment does, with every service in a container, use `pnpm openrum up` instead. The console keeps the same address either way.

The two modes share that address and therefore do not run at the same time. Entering one stops the other's half: `dev` stops the API and proxy containers, and `up` stops the host processes. This is deliberate. Two stacks against one database means two APIs and two consumers, and the half-processed data that results reads as a bug in the product rather than as a mistake in setup.

### Commands

| Command                       | Effect                                                                        |
| ----------------------------- | ----------------------------------------------------------------------------- |
| `pnpm openrum dev`            | API and console from source, everything else in containers                     |
| `pnpm openrum up`             | Every service in a container                                                  |
| `pnpm openrum status`         | What is running, and what is not ready yet                                    |
| `pnpm openrum logs [service]` | Follow logs; a host service tails its own file                                |
| `pnpm openrum restart <name>` | Restart one service and wait for it to come back                              |
| `pnpm openrum stop`           | Stop everything, keeping the containers and their data                        |
| `pnpm openrum down`           | Remove the containers, keeping the volumes                                    |
| `pnpm openrum reset`          | Remove the containers and delete every local database, after confirming       |

Ports and credentials come from `deploy/compose/.env`, falling back to the committed `deploy/compose/.env.example`. Both halves of the stack read that one file, so changing `CONSOLE_PORT` there moves the console in both modes.

Supervised host processes are detached from the terminal that started them, so closing it does not take the stack down. Their process identifiers and logs live in `.openrum/`, which git ignores. Process supervision uses sessions and process groups, so the command runs on macOS and Linux; on Windows, use WSL.

The underlying Compose commands remain available and are what the [quickstart](quickstart.md) uses. `openrum` adds the parts Compose cannot express: waiting for readiness rather than for launch, supervising the host half, deriving that half's environment from the same file, naming the process behind a port conflict, and reporting both halves in one place.

Use the development account:

```text
Email: demo@openrum.local
Password: OpenRUM-demo-2026!
```

These credentials and DSNs are local examples. Do not reuse them outside the Compose environment.

Object storage is disabled by default and is not needed for behavior analytics, errors, performance or API monitoring. To test it, configure one provider in the API and worker environments:

```sh
# Alibaba OSS native API; omit both keys when using an ECS/ACK RAM Role.
OBJECT_STORAGE_PROVIDER=oss
OBJECT_STORAGE_ENDPOINT=https://oss-cn-hangzhou.aliyuncs.com
OBJECT_STORAGE_BUCKET=your-test-bucket
OBJECT_STORAGE_REGION=cn-hangzhou
OSS_ACCESS_KEY_ID=...
OSS_ACCESS_KEY_SECRET=...

# Or Amazon S3 / MinIO / R2 / Ceph. Custom endpoints default to path-style requests.
OBJECT_STORAGE_PROVIDER=s3
OBJECT_STORAGE_ENDPOINT=http://127.0.0.1:9000
OBJECT_STORAGE_BUCKET=your-test-bucket
OBJECT_STORAGE_REGION=us-east-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
```

For production custom endpoints, use HTTPS and add the exact host to `OPENRUM_OBJECT_STORAGE_ENDPOINT_ALLOWLIST`. Amazon S3 can omit the endpoint and use the regional default. Workload roles are preferred over static keys.

## Repository map

- `apps/web`: React console, routes and design system
- `packages/browser-sdk`: browser telemetry SDK
- `packages/protocol`: event contract and generated validators
- `packages/vite-plugin`: release and Source Map integration
- `services/api`: control plane and query API
- `services/ingest`: public event intake
- `services/consumer`: Kafka-to-ClickHouse pipeline
- `services/worker`: background and Source Map jobs
- `internal`: shared Go packages
- `migrations`: PostgreSQL and ClickHouse migrations

## Common commands

```sh
# Focused frontend development
pnpm --filter @openrum/web test:unit
pnpm --filter @openrum/web typecheck
pnpm --filter @openrum/web lint

# Go development
go test ./...
go vet ./...

# Complete repository validation
pnpm run check

# Isolated PostgreSQL, ClickHouse, Kafka and Redis integration suite
pnpm run test:integration

# Browser product journeys
pnpm run test:e2e
```

Run `pnpm run check` before opening a pull request. It includes formatting, linting, type checks, tests, protocol generation checks, builds and size budgets.

`pnpm run test:integration` starts the required Compose dependencies, creates localhost-only `openrum_test` databases and a dedicated `openrum-integration-v1` Kafka topic, applies migrations and runs every Go test tagged `integration`. The runner refuses destructive database tests unless the target host is local and the database name ends in `_test`.

## Migrations and service logs

Migrations and the demo seed run on every start. Both are idempotent, and both run from the locally built image, so adding a migration rebuilds that image, which recreates the job, which applies the new file. There is nothing to rerun by hand.

Inspect health and logs with:

```sh
pnpm openrum status
pnpm openrum logs api
pnpm openrum logs ingest consumer worker
```

`stop` keeps the containers and their data so the next start is quick, `down` removes the containers but keeps the volumes, and `reset` deletes every local database and asks first.

## The documentation site

The public site and documentation in `apps/site` are not part of the runtime stack and `openrum` does not manage them. They have no infrastructure dependencies and ship through their own static build:

```sh
pnpm site:dev
```

## Troubleshooting

- If a port is occupied, `openrum` names the process holding it. A process it started itself is cleared automatically; anything else is left alone for you to decide about.
- If writes return a CSRF error, confirm that the browser origin exactly matches `PUBLIC_BASE_URL`. Both modes serve the console on `CONSOLE_PORT`, so opening a different port is the usual cause.
- If a host service fails to start, read `.openrum/log/api.log` or `.openrum/log/web.log`, which is where its output goes.
- If charts are initially empty, wait for ClickHouse materialized views and refresh.
- If generated or installed dependencies drift, run `pnpm install --frozen-lockfile` from the repository root.

See [demo data](demo-data.md) for reseeding and dataset details.

To generate traffic on demand while working on a query or a page, use the
[development data generator](dev-data.md). It is available in the console at
**造数据** and posts through the real ingest endpoint, so the rows it produces
have been through the same normalization and aggregation as production traffic.
