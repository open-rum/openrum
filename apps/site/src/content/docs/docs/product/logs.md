---
title: Logs
description: Search structured application logs and relate them to browser sessions.
---

**Applies to:** Alpha / main. Status: Alpha implemented.

The Logs page shows diagnostic messages separately from business events and error Issues. Use the shared time/environment controls, severity selector and query search. The chart and list span the page without a dimension sidebar.

## Send logs

```ts
import { init, logger, setUser } from "@openrum/browser";

init({
  dsn: "YOUR_PROJECT_DSN",
  captureConsole: ["warn", "error"], // Optional; off by default.
});
setUser("customer-123"); // Pseudonymous application ID, not an email.
logger.info("checkout started", { "order.id": "order-123", items: 3 });
logger.error("payment failed", { "error.code": "UPSTREAM_TIMEOUT" });
```

Levels: `trace`, `debug`, `info`, `warn`, `error`, `fatal`. `client.logger` and the singleton `logger` provide the same methods. Logs share `eventSampleRate` and the bounded low-priority queue. Error/fatal logs do not create Issues. `beforeSendLog` can transform a log or return `null`.

Calling `logger.*` is the opt-in; initialization alone collects no application logs. `captureConsole` separately opts into only the listed console methods and works without `enableLogs`. The former `enableLogs` option is accepted for configuration compatibility but no longer gates either path.

Call `setUser(undefined)` on logout. Identity is captured when each log occurs, not when the batch uploads, and is not backfilled on older logs. `setUser` accepts an ID only, not a name/email profile object. Details show the captured user ID and anonymous visitor ID with same-user/visitor search actions.

Never intentionally log secrets or personal data. Messages and primitive attributes are bounded and scrubbed on the client and consumer. Project custom redaction rules also apply. Console forwarding preserves original output and does not serialize objects.

## Search and investigate

- `payment failed`: case-sensitive message substrings; both words must match.
- `severity:error message:"payment failed"`: level and phrase.
- `logger:payment order.id:order-123`: source and exact custom attribute.
- `country:CN device:mobile route:/checkout`: country, device and route; `browser` and `release` are also supported.
- `attributes.level:custom`: disambiguate an attribute from a built-in field.
- `session_id:<uuid>` / `trace_id:<id>`: related logs.
- `user.id:"customer-123"`: exact user ID (`user_id` / `userId` also work). Bare text searches only messages.
- `anonymous_user_id:"visitor-id"`: same anonymous visitor, including logs without a user ID.
- `attributes.user.id:custom`: a custom attribute named `user.id`, not the SDK identity.

Conditions use AND semantics, with up to 12 terms / 1,024 characters. OR, wildcard expansion and numeric comparisons are not supported. Double-quote values containing spaces.

Click a message to inspect properties, filter by an attribute or open the related Session. Export downloads only the current page as JSONL. The volume chart reports captured counts, not sampling estimates. Time ranges are capped at 30 days; narrow expensive queries to retry.

## Boundaries and upgrades

Trace context appears only when supplied in the envelope. This version does not automatically instrument distributed tracing, collect server stdout, provide live tail, log-specific alerts or aggregate-query builders.

Apply ClickHouse migration `0008_logs` and deploy updated ingest, consumer and API services before clients send Logs. Old ingest validators can reject log-containing batches. Local development provides a structured-logs data-generator preset.
