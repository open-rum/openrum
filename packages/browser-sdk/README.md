# `@openrum/browser`

Privacy-bounded Browser SDK for OpenRUM Alpha. It captures Page Views, safe click descriptors, JavaScript errors and unhandled rejections, fetch/XHR timings, Web Vitals (LCP, INP, CLS, FCP and TTFB) and governed Custom Events.

## Install and initialize

```sh
pnpm add @openrum/browser
```

```ts
import { captureEvent, init, setTag, setUser } from "@openrum/browser";

const client = init({
  dsn: import.meta.env.VITE_OPENRUM_DSN,
  environment: "production",
  release: "storefront@1.8.0",
  eventSampleRate: 0.25,
  apiSampleRate: 0.1,
  errorSampleRate: 1,
});

setUser("account_01J8M7C5"); // opaque application identifier, never an email
setTag("plan", "self-hosted");
captureEvent("checkout_started", {
  attributes: { plan: "standard", channel: "organic" },
  measurements: { cart_value: 249.9 },
});

await client.close();
```

Without a bundler, load the immutable IIFE build from the OpenRUM Instance that issued the DSN:

Synchronous loading initializes as early as possible, but blocks HTML parsing while the bundle downloads:

```html
<script src="https://rum.example.com/sdk/browser/0.1.1/openrum.min.js"></script>
<script>
  OpenRUM.init({
    dsn: "https://YOUR_PUBLIC_DSN@rum.example.com/ingest/v1/envelope",
    environment: "production",
  });
</script>
```

Asynchronous loading is recommended for most pages because it does not block HTML parsing. Initialize only from `onload`; placing `OpenRUM.init()` immediately after a script with the `async` attribute creates a race:

```html
<script>
  (function () {
    var script = document.createElement("script");
    script.src = "https://rum.example.com/sdk/browser/0.1.1/openrum.min.js";
    script.async = true;
    script.onload = function () {
      OpenRUM.init({
        dsn: "https://YOUR_PUBLIC_DSN@rum.example.com/ingest/v1/envelope",
        environment: "production",
      });
    };
    document.head.appendChild(script);
  })();
</script>
```

`init()` installs the default integrations and returns the active client. Repeated calls while it is running return the same client. Use `captureEvent`, `setUser`, `setTag`, `addBreadcrumb`, `getClient` and `close` for the shipped singleton API; advanced integrations can use `OpenRUMClient` directly.

## Structured logs

Logs are explicit by use: calling `logger.*` emits a log, while initialization by itself collects none. The Console's **日志** page searches the same Project, Environment and time range as other analysis pages.

```ts
import { init, logger } from "@openrum/browser";

init({
  dsn: import.meta.env.VITE_OPENRUM_DSN,
  // Optional: leave unset to keep all console output local.
  captureConsole: ["warn", "error"],
  beforeSendLog: (log) => (log.level === "debug" ? null : log),
});
logger.info("checkout started", { "order.id": "order-123", items: 3 });
logger.error("payment failed", { "error.code": "UPSTREAM_TIMEOUT" });
```

Both the singleton `logger` and `client.logger` support `trace`, `debug`, `info`, `warn`, `error`, and `fatal`. Messages are bounded to 4,096 characters; up to 20 primitive attributes are converted to bounded strings. Sensitive keys and values are scrubbed again after `beforeSendLog`. Never pass credentials or personal data intentionally: pattern-based scrubbing is not a guarantee of anonymization.

`captureConsole` is an independent opt-in and does not require another flag. The former `enableLogs` option remains accepted for configuration compatibility but no longer gates explicit logger calls or console forwarding.

Set an opaque application identity with `setUser("customer-123")` before logging and clear it with `setUser(undefined)` on logout. Each log snapshots that ID and the anonymous visitor ID at capture time. Search the Console with `user.id:"customer-123"` (`user_id` / `userId` also work), or `anonymous_user_id:"visitor-id"`. Log details show both identifiers and provide same-user/visitor actions. `setUser` accepts only an ID; it does not collect a name/email profile.

Logs share `eventSampleRate`, remote sampling and the bounded low-priority sender queue. Error/fatal **logs do not create Issues**; exceptions remain separate. Console forwarding preserves the original output and represents objects as `[Object]` instead of serializing arbitrary objects. Remove `captureConsole` to disable forwarding. No server stdout collector or automatic distributed-trace instrumentation is installed.

See [Logs](../../docs/logs.md) for search syntax, limits and rollout order.

## Privacy defaults

- URLs are normalized without query strings or fragments.
- API capture excludes request/response bodies, headers and OpenRUM's own endpoints.
- Click capture records only a bounded element type, allowed ARIA role/input type and optional `data-openrum-name`; it never reads input values or visible text.
- Attribute keys that look like credentials, contact details or session data are rejected. Email, authorization and payment-like values are scrubbed.
- `setUser` accepts a pseudonymous ID up to 128 characters and rejects email addresses.
- Custom Events accept at most 20 bounded string attributes and 20 finite numeric measurements. Names beginning `openrum.` are reserved.

Disable automatic click capture with `captureClicks: false`. Remote Project sampling refresh can be disabled with `configEndpoint: false`; invalid remote configuration falls back to local options.

## Development

```sh
pnpm --filter @openrum/browser typecheck
pnpm --filter @openrum/browser test
pnpm --filter @openrum/browser build
```

The runnable integration is under `examples/react-vite`.
