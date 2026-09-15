# Logs

OpenRUM Logs is a browser-application diagnostic explorer inspired by [Sentry Logs](https://docs.sentry.io/product/explore/logs/). It is separate from business Custom Events and grouped error Issues.

## Capture

Call `client.logger.info("checkout started", { "order.id": "order-123" })` to emit a log. Six methods are available: `trace`, `debug`, `info`, `warn`, `error`, `fatal`; the singleton `logger` provides the same methods. Calling a logger is the opt-in—initialization alone does not collect application logs.

`captureConsole: ["warn", "error"]` is a separate opt-in that forwards only those console methods, preserving their original output. Omit it to keep all console output local. Objects are not serialized. `beforeSendLog` can transform a log or return `null`; exceptions in instrumentation never escape into the monitored application. The former `enableLogs` option remains accepted for configuration compatibility but no longer gates either path.

Logs carry the existing page, Session, Environment, Release, device and country context. Trace/Span fields are displayed and searchable **when supplied in the envelope**; the Browser SDK does not automatically instrument distributed tracing. Logs use Event sampling and the low-priority bounded queue. Console totals are captured counts, not extrapolated estimates. An error-level log is not an exception and never creates an Issue.

Call `client.setUser("customer-123")` (or the singleton `setUser`) before logging to attach a pseudonymous application user ID. Use `setUser(undefined)` on logout. Each log snapshots the identity at capture time; signing in later does not backfill earlier logs. `setUser` currently accepts only an ID, not a profile object or email address. Details show this user ID and the anonymous visitor ID, with actions to search matching logs. Existing stored identity fields need no new migration or SDK upgrade.

## Explore

Open **日志** in the Project navigation. The persistent time/environment controls scope the entire page. Query search and severity apply to both the full-width stacked volume chart and the list; this page has no shared dimension sidebar. Use visible query terms such as `country:CN device:mobile route:/checkout` for dimensions. Search and severity are URL-backed; changing time or filters clears pagination. Old sidebar URL parameters are removed along with their pagination cursor.

The list sorts newest first, with 50 rows per page (API maximum 100), keyset pagination, log details, per-attribute filtering, same-Session/Trace filtering, a Session link, clipboard JSON, and **current-page-only** JSONL export. Query failures remain visible with retry; empty results show SDK setup guidance.

### Search grammar

- `payment failed`: case-sensitive message substrings; all terms must match.
- `message:"payment failed" severity:error`: a phrase and an exact level.
- `logger:payment environment:production release:web@1.2`.
- `order.id:order-123`: exact custom-attribute match.
- `attributes.level:custom`: explicitly select an attribute whose name collides with a built-in field. Detail-panel filters always use this namespace.
- `session_id:<uuid>` or `trace_id:<32-character-id>`.
- `user.id:"customer-123"`: exact captured user ID; `user_id` and `userId` are aliases. Bare text searches only the message.
- `anonymous_user_id:"visitor-id"`: exact anonymous visitor ID (`anonymousUserId` also works).
- `attributes.user.id:custom`: query a custom attribute named `user.id` rather than the captured identity.
- Built-in fields also include `level`, `route`, `country`, `device`, and `browser`.

Double-quote values containing spaces; escape quotes/backslashes with a backslash. The initial grammar is AND-only, with at most 12 terms / 1,024 characters. OR, wildcard expansion and numeric comparisons are not supported. Attribute values are stored as strings, not typed aggregation columns.

## Privacy, access and limits

Schema validation bounds messages (4,096 characters), logger names (80), and attributes (20 keys, 64-character keys / 512-character values). SDK scrubbing and the consumer privacy floor remove known sensitive keys, emails, bearer credentials and card-like values. Project custom redaction patterns also apply to log messages, logger names and attributes. Do not intentionally log secrets or personal data.

The authenticated API checks Project membership before querying. All query values are parameterized. Raw retention expiry is enforced at query time, not only by ClickHouse background TTL. Requests allow up to 30 days, with an 8-second / 5-million-row per-query scan ceiling and a 10-second HTTP context deadline. Over-budget requests fail rather than return misleading partial totals; narrow the range and retry.

## Local validation and rollout

Apply `0008_logs` to ClickHouse **before** deploying the consumer and ingest binaries. Deploy the new API and Console, then upgrade and opt in to the Browser SDK. Deploying the SDK first can cause old ingest schema validators to reject log-containing batches. Existing Events keep their schema and defaults.

The development-only data constructor has a **结构化应用日志** (`logs`) preset that sends six levels through ingest → Kafka → consumer → ClickHouse, with Session and Trace context. It is not enabled in production and does not fabricate logs in ordinary Console responses.

This version does not include live tail/auto-refresh, server stdout collection, log-specific alerts, saved queries, aggregate-query builders, or full trace waterfalls.
