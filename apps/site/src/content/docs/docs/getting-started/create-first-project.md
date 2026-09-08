---
title: Create your first project
description: Create a Project, install the Browser SDK and verify the first Event.
---

**Applies to:** Alpha / main.

This guide assumes you already started a local Instance with the [Five-minute Quickstart](/docs/getting-started/quickstart/). Use the Demo Organization for evaluation, or create your own Project when you are ready to send real browser traffic.

## 1. Create a Project

1. Sign in to the Console at `http://127.0.0.1:4173`.
2. Open **Settings → Projects** and create a Project for one web product.
3. Choose an Environment such as `development` or `production`.
4. Create a write key under **Settings → Project keys**. Copy it once; treat it as a browser-public key protected by Origin allowlists and rate limits, not by secrecy alone.

## 2. Install the Browser SDK

```sh
pnpm add @openrum/browser
```

```ts
import { captureEvent, init } from "@openrum/browser";

init({
  endpoint: "http://127.0.0.1:8081/ingest/v1/envelope",
  writeKey: import.meta.env.VITE_OPENRUM_WRITE_KEY,
  environment: "development",
  release: "storefront@0.1.0",
});

captureEvent("first_event", {
  attributes: { source: "create-first-project" },
});
```

For a runnable example, copy `examples/react-vite/.env.example` to `.env.local`, set the write key, then run:

```sh
pnpm --filter @openrum/example-react-vite dev
```

See the [Browser SDK](/docs/sdk/browser/) guide for framework setup, and
[Next.js](/docs/sdk/nextjs/) or [Astro](/docs/sdk/astro/) if the application renders on the
server.

## 3. Verify the first Event

1. Open your app and trigger a page view or the `first_event` Custom Event.
2. In the Console, open **Events** and confirm the event arrives within a few seconds.
3. Open **Sessions** and confirm the same `session_id` groups related page, API and error events.
4. If you raised an error, follow it to an **Issue** and inspect Session context.

## Troubleshooting

- Event missing: confirm ingest health, write-key Origin allowlist and that Consumer / ClickHouse are healthy.
- CORS or network failure: the browser endpoint must match the public ingest URL and allowed Origins.
- Source Map frames unavailable: expected until optional object storage is configured. Core monitoring still works.

Next: [Domain model](/docs/getting-started/domain-model/), [Self-hosting overview](/docs/self-hosting/overview/), or [Investigation](/docs/product/investigation/).
