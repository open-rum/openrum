# Rate limit code map

Read this file before changing Ingest throttling, the Project Rate Limit setting, Browser SDK retry behavior, or public rate-limit documentation.

## Stable product rules

- A **Project Rate Limit** counts Ingest requests per second, not Events. One accepted request may contain up to 100 Events.
- Every DSN and Environment in one Project shares the same Project Rate Limit. Do not add an Environment selector to this setting without revisiting ADR 0003.
- The public Ingest edge also has a pre-authentication per-IP limit. It is separate from the Project Rate Limit and runs before the DSN identifies a Project.
- An unset Project override inherits the current Instance default. The Console must read that default from the Project API rather than duplicate it.
- `reject` is an exact fixed-window cap. `sample` sheds stable caller buckets to preserve complete callers and can admit up to twice the configured limit in one window.
- Redis owns the shared counters. When Redis is unavailable, each Ingest process independently enforces half of the relevant limit, so the Instance-wide total is no longer exact.
- A rejected request returns `429`, `Retry-After`, `X-OpenRUM-RateLimit-Scope`, and `X-OpenRUM-RateLimit-Limit`. Keep `RATE_LIMITED` as the error code so existing SDK guidance remains compatible.

## Change map

| Concern                                           | Primary files                                                                                                            |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| PostgreSQL fields and constraints                 | `migrations/postgres/0015_project_ingest_quota.*.sql`                                                                    |
| Project persistence and cache input               | `internal/metadata/projects.go`, `internal/metadata/models.go`, `internal/metadata/project_keys.go`                      |
| Control API fields and validation                 | `services/api/internal/handlers/projects.go`, `internal/metadata/project_settings_integration_test.go`                   |
| Redis/local fixed-window decisions                | `internal/ingest/limits.go`, `internal/ingest/limits_test.go`                                                            |
| Ingest ordering, 429 headers and CORS exposure    | `services/ingest/internal/handler.go`, `services/ingest/internal/handler_test.go`                                        |
| Last rejection signal                             | `internal/ingest/connection_status.go`, `services/api/internal/handlers/connection_status.go`                            |
| Prometheus envelope counters                      | `services/ingest/internal/metrics.go`                                                                                    |
| Browser SDK retry queue and `Retry-After` parsing | `packages/browser-sdk/src/transport/sender.ts`, `packages/browser-sdk/test/transport.test.ts`                            |
| Console API model                                 | `apps/web/src/lib/api/projects.ts`                                                                                       |
| Console Project setting                           | `apps/web/src/features/settings/ProjectQuotaPage.tsx`, `apps/web/src/features/settings/ProjectDataSettingsShell.tsx`, `apps/web/src/features/settings/projectDataSettings.ts` |
| E2E API fixture                                   | `tests/e2e/mockOpenRUM.ts`, `tests/e2e/rate-limits.spec.ts`                                                              |
| Public product documentation                      | `apps/site/src/content/docs/docs/product/rate-limits.md`, `apps/site/src/content/docs/zh/docs/product/rate-limits.md`    |
| Deployment implications                           | `apps/site/src/content/docs/docs/self-hosting/capacity.md`, `apps/site/src/content/docs/docs/self-hosting/kubernetes.md` |

## Request path

The Console entry is **项目设置 → 数据管理 → 速率限制**; the existing
`/settings/project/:projectId/quota` route remains valid. Regular SDK sampling
is the adjacent **采样配置** section (`ProjectSamplingPage.tsx`), not part of
the request limiter. Project usage reports remain a separate settings entry.

1. `Handler.ServeHTTP` resolves the caller IP and applies the pre-authentication IP limit.
2. The DSN key is authenticated and the Project plus its cached settings are loaded.
3. Origin is checked and CORS response headers are set.
4. The Project Rate Limit is applied before the request body is read or parsed.
5. Only an admitted request reaches envelope validation and Kafka acceptance.

Because step 4 happens before parsing, the existing usage aggregates cannot count rate-limited Events or reconstruct the rejected envelope's composition. Do not present usage totals as rate-limit hits. A real Project trend requires a new bounded counter path keyed by Project and outcome.

## Validation

Run the smallest relevant set first, then the broader repository checks required by the change:

```sh
go test ./internal/ingest ./services/ingest/internal ./services/api/internal/handlers
pnpm --filter @openrum/web typecheck
pnpm exec playwright test tests/e2e/rate-limits.spec.ts
pnpm site:build
pnpm site:spell
```

When the algorithm changes, add deterministic unit cases for the exact boundary, previous-window behavior, stable caller decisions, overshoot ceiling, and Redis fallback. When the HTTP contract changes, assert headers for both `ip` and `project` scopes.

## Known gaps

- Project-level hit count and history are not persisted; the Console can only show whether the most recent recorded rejection was `RATE_LIMITED`.
- The Instance Project default and pre-authentication IP ceiling are code defaults rather than Instance Settings.
- Project limits are shared by all Environments; there are no Environment reservations.
- The limiter uses one-second fixed windows rather than a configurable burst budget or token bucket.
- There is no alert condition for sustained Project Rate Limit rejection.
