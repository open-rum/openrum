# OpenRUM Alpha quickstart

## Prerequisites

- Docker Engine or Docker Desktop with Compose v2
- At least 8 GB memory available to Docker
- Free host ports `4173`, `5433`, `8123`, `9000`, `9092` and `6379`

## Start

From the repository root, run:

```sh
docker compose --env-file deploy/compose/.env.example -f deploy/compose/docker-compose.yml up -d --build
```

If you are developing from source rather than evaluating, use `pnpm openrum up` instead; it drives the same containers but waits for readiness and reports the whole stack in one table. It needs the Go and Node toolchains, so this page stays on Compose. See [local development](local-development.md).

Wait until `docker compose --env-file deploy/compose/.env.example -f deploy/compose/docker-compose.yml ps` shows the long-running services as healthy. Open `http://127.0.0.1:4173` and use:

```text
Email: demo@openrum.local
Password: OpenRUM-demo-2026!
```

## Verify the product journey

1. Open **分析 → 漏斗**, start with `页面访问 → 元素点击`, then add `checkout_started` and `order_completed`. Run the funnel to see progressively fewer sessions.
2. Open **洞察**, choose the error evidence link, and select the latest error event.
3. In **行为时间线**, confirm that navigation, purchase click, failed `POST /api/orders` and the error appear together.
4. In **错误堆栈**, inspect the seeded mapped frame at `src/checkout/submit.ts:42`. Live Source Map uploads require optional object storage.
5. Check **性能** and **API** for seeded Web Vitals and request latency/failure samples.

The deterministic ecommerce dataset contains roughly 30,000 sessions, 12,000 anonymous visitors and 301,000 events over 14 days. Approximate labels reflect the production query strategy. See [demo data](demo-data.md) for the generated dimensions, rerun command and reset behavior.

## Send events from the example app

Install dependencies with Node 24 and pnpm 11, then inspect `examples/react-vite/src` for SDK setup. In OpenRUM, open **设置 → 客户端 DSN**, copy the default DSN generated with the Project, and place it in the example's local environment. Do not commit it. The example emits page views, a custom behavior event, API timing and a test error.

## Troubleshooting

- Port conflict: copy `deploy/compose/.env.example` to `deploy/compose/.env`, change the conflicting port, and pass that file with `--env-file`.
- Seeder or migration failure: inspect `docker compose ... logs migrate demo-seed` before restarting.
- Empty charts immediately after start: wait a few seconds for ClickHouse materialized views, then refresh.
- Browser rejects cookies: use exactly `http://127.0.0.1:4173`, matching `PUBLIC_BASE_URL`.
- Reset the demo: `docker compose ... down --volumes` permanently removes only this Compose project's local volumes; start again to recreate them.

The local stack uses example secrets, a single Kafka broker and single-node ClickHouse. It is an evaluation environment, not a production deployment recipe.

Object storage is not required for this quickstart. Configure it separately only when you need live Source Map uploads or future Session Replay blobs.

For source development with Vite hot reload and a locally running Go API, continue with the [local development guide](local-development.md).
