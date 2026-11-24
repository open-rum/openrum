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

If you are developing from source rather than evaluating, use `pnpm openrum up` instead; it drives the same containers but waits for readiness and reports the whole stack in one table. It needs the Go and Node toolchains, so this page stays on Compose. See [local development](https://openrum.netlify.app/docs/getting-started/local-development/).

Wait until `docker compose --env-file deploy/compose/.env.example -f deploy/compose/docker-compose.yml ps` shows the long-running services as healthy, then open `http://127.0.0.1:4173`.

The first visit opens the setup page, where you register the initial owner account and sign in.

## Verify the product journey

After signing in and creating a Project, you can either connect the example app below or use the local development data generator (the floating flask button **造数据** at the bottom-right of the Console when running in development mode) to generate test traffic, then verify:

1. **分析 → 漏斗**: build a funnel across page views, clicks and custom events.
2. **洞察** and **错误**: open an error event and inspect its stack trace and release context.
3. **会话**: confirm that navigation, interactions, API requests and errors appear on the same timeline.
4. **性能** and **API**: inspect Web Vitals and request latency/failure samples.

## Send events from the example app

Install dependencies with Node 24 and pnpm 11, then inspect `examples/react-vite/src` for SDK setup. In OpenRUM, open **设置 → 客户端 DSN**, copy the default DSN generated with the Project, and place it in the example's local environment. Do not commit it. The example emits page views, a custom behavior event, API timing and a test error.

## Troubleshooting

- Port conflict: copy `deploy/compose/.env.example` to `deploy/compose/.env`, change the conflicting port, and pass that file with `--env-file`.
- Migration failure: inspect `docker compose ... logs migrate` before restarting.
- Empty charts immediately after start: wait a few seconds for ClickHouse materialized views, then refresh.
- Browser rejects cookies: use exactly `http://127.0.0.1:4173`, matching `PUBLIC_BASE_URL`.
- Reset local data: `docker compose ... down --volumes` permanently removes only this Compose project's local volumes; start again and complete first-time setup to reinitialize.

The local stack uses example secrets, a single Kafka broker and single-node ClickHouse. It is an evaluation environment, not a production deployment recipe.

Object storage is not required for this quickstart. Configure it separately only when you need live Source Map uploads or future Session Replay blobs.

For source development with Vite hot reload and a locally running Go API, continue with the [local development guide](https://openrum.netlify.app/docs/getting-started/local-development/).
