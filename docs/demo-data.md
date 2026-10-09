# Demo data generator

OpenRUM includes an idempotent generator at `services/api/cmd/demo`. It creates the development owner, organization and storefront project, then loads a deterministic ecommerce dataset into ClickHouse.

## What it generates

The current dataset covers 14 days and contains approximately:

- 30,000 sessions and 12,000 anonymous visitors
- 549,000 visible events
- Page views, navigation, clicks, product views, cart additions, checkout starts and completed orders
- LCP, INP and CLS samples across normalized routes
- 32 API endpoints across `GET`, `POST`, `PATCH` and `DELETE`
- Grouped checkout, JavaScript and chunk-loading errors
- Stack mappings that make the generated errors useful in the Source Map UI
- Country, device, browser, operating system, acquisition channel, campaign, product category and member-tier dimensions

Traffic follows hourly and weekday/weekend patterns. Conversion, latency and failures vary by channel and device instead of using flat random values. Product routes are normalized as `/products/:id` to avoid unrealistic high-cardinality performance groups.

## What the API endpoints exercise

Each endpoint owns its own latency, response size and error mix, because a
single shared distribution cannot express the questions the API workspace is
meant to answer:

- **Failures separate from client errors.** `POST /api/auth/refresh` and `GET /api/coupons/:code` return many 401s and 404s while staying near a 0.5% failure rate. The SDK flags a request only at status 500 and above, so these raise the client-error count without moving the failure rate.
- **Response size independent of latency.** `GET /api/shipping/quotes` is slow with a small body, `GET /api/products/:id/reviews` is faster with a much larger one. Comparing them shows whether an endpoint is network-bound or size-bound.
- **A browser regression.** `GET /api/products/:id/recommendations` is roughly four times slower on Safari, which the dimension drill-down surfaces.
- **A release regression.** `POST /api/payments/intent` fails around 13% on `web@2026.09.3` against roughly 3% on older releases.
- **Endpoints below the sample threshold.** The three `/api/admin` and `/api/support` endpoints stay under 75 requests, so quantile ranking labels them as insufficient data.
- **Every transport failure kind.** Status 0 appears with `network`, `timeout` and `abort`, alongside 500, 502, 503 and 504.

## Load the dataset

Seeding is a command of its own and never runs as part of a start. Start the stack, then load the dataset into it:

```sh
pnpm openrum up    # or: pnpm openrum dev
pnpm openrum seed
```

Without Go, run the same containerized job through Compose. The `demo-seed` service sits behind the `seed` profile, so a plain `up` ignores it:

```sh
docker compose --profile seed --env-file deploy/compose/.env.example -f deploy/compose/docker-compose.yml run --rm --no-deps demo-seed
```

The generated account is:

```text
Email: demo@openrum.local
Password: OpenRUM-demo-2026!
```

If the instance was initialized by another owner and the demo owner does not exist, the generator exits without modifying the instance. Seeding is therefore for a new or demo-only stack; on a stack you already set up yourself it does nothing.

## Run the generator again

`pnpm openrum seed` can be repeated at any time. It builds the generator image first and passes `--no-deps`, so healthy database containers are not restarted.

To run it directly from source against the default local Compose databases:

```sh
POSTGRES_DSN='postgres://openrum:openrum_local_only@127.0.0.1:5433/openrum?sslmode=disable' \
CLICKHOUSE_DSN='clickhouse://openrum:openrum_local_only@127.0.0.1:9000/openrum' \
go run ./services/api/cmd/demo
```

The command prints the project ID when it completes. On first project creation it also prints the SDK write key once; treat that key as a secret even in development.

## Idempotency and determinism

The large dataset has a version marker and deterministic event IDs. Running the same version repeatedly does not duplicate events. The small compatibility fixture is also guarded by its own marker.

Changing generator code does not automatically rewrite an already completed dataset with the same version. When a schema or fixture change requires new records, increment the dataset version and update its completion marker. Keep generated timestamps inside the ClickHouse raw-event retention window.

Incrementing the version is not enough on its own. The aggregate tables are fed by materialized views on insert, so the previous dataset's rows stay in `api_metrics_1m` and its siblings and the two datasets are summed. Delete the demo project from the raw and aggregate tables before reseeding:

```sh
PROJECT=11111111-1111-4111-8111-111111111111
for TABLE in rum_events_local event_stack_mappings_local project_metrics_1m_local \
  api_metrics_1m_local issue_metrics_5m_local behavior_metrics_1m_local \
  usage_metrics_1h_local usage_records_local; do
  docker exec openrum-clickhouse-1 clickhouse-client --user openrum \
    --password openrum_local_only -d openrum \
    --query "ALTER TABLE $TABLE DELETE WHERE project_id='$PROJECT' SETTINGS mutations_sync=2"
done
```

The generator is intentionally scoped to the demo project. Do not point the example DSNs at staging or production.

## Complete local reset

For a completely fresh dataset, remove only this Compose project's volumes and start it again:

```sh
pnpm openrum reset
pnpm openrum up
pnpm openrum seed
```

`reset` asks for confirmation. The Compose equivalents are `down --volumes` followed by `up -d --build` and the seed command above.

This permanently deletes the local PostgreSQL, ClickHouse, Kafka, Redis and object-storage data for the Compose project. It is not required for a normal generator rerun.

## Verify the generated data

After seeding, open `http://127.0.0.1:4173` and check:

1. **分析** for country distribution and the product-to-order funnel.
2. **性能** for `/products/:id` LCP, INP and CLS percentiles.
3. **API** for product and order endpoints, failures and P95 latency.
4. **错误** for the three generated error groups and mapped frames.

Generator unit coverage lives beside the command:

```sh
go test ./services/api/cmd/demo
```
