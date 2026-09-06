# `@openrum/browser`

Privacy-bounded Browser SDK for OpenRUM Alpha. It captures Page Views, safe click descriptors, JavaScript errors and unhandled rejections, fetch/XHR timings, Core Web Vitals and governed Custom Events.

## Install and initialize

```sh
pnpm add @openrum/browser
```

```ts
import { captureEvent, init, setTag, setUser } from "@openrum/browser";

const client = init({
  endpoint: "https://rum.example.com/ingest/v1/envelope",
  writeKey: import.meta.env.VITE_OPENRUM_WRITE_KEY,
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

`init()` installs the default integrations and returns the active client. Repeated calls while it is running return the same client. Use `captureEvent`, `setUser`, `setTag`, `addBreadcrumb`, `getClient` and `close` for the shipped singleton API; advanced integrations can use `OpenRUMClient` directly.

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
