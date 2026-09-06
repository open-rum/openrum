---
title: Browser SDK
description: Install automatic capture, Custom Events, identity, privacy and sampling.
---

**Shipped package:** `@openrum/browser` (Alpha).

```sh
pnpm add @openrum/browser
```

```ts
import { captureEvent, init, setUser } from "@openrum/browser";

const client = init({
  endpoint: "https://rum.example.com/ingest/v1/envelope",
  writeKey: import.meta.env.VITE_OPENRUM_WRITE_KEY,
  environment: "production",
  release: "storefront@1.8.0",
});
```

Automatic capture covers Page Views, bounded interaction descriptions, JavaScript errors, unhandled rejections, fetch/XHR timing and Core Web Vitals. The SDK excludes query strings, request/response bodies, headers, raw input values and its own ingest endpoint.

## Custom Event

```ts
captureEvent("checkout_started", {
  attributes: { plan: "standard", channel: "organic" },
  measurements: { cart_value: 249.9 },
});
```

Names and values are bounded and scrubbed in the browser. Do not send email, phone, payment data, authentication tokens or free-form user text.

## Identity

Use `setUser("account_opaque_id")`. Prefer an internal opaque ID; email addresses are rejected. Calling `setUser(undefined)` clears the identity. Sessions are activity windows and renew independently of user identity.

## Sampling

Errors are sampled independently from general events and API Requests. Remote Project settings refresh no more often than five minutes, and invalid configuration falls back safely to local values.
