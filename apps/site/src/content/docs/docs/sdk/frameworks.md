---
title: Framework examples
description: Install OpenRUM in React, Vite and other browser applications.
---

**Applies to:** Alpha / main. Package: `@openrum/browser`.

## React + Vite

The repository ships a runnable example at `examples/react-vite`.

1. Start the local OpenRUM Instance and create a Project write key.
2. Copy environment values:

```sh
cp examples/react-vite/.env.example examples/react-vite/.env.local
```

3. Set `VITE_OPENRUM_WRITE_KEY` and the ingest endpoint, then start the example:

```sh
pnpm --filter @openrum/example-react-vite dev
```

4. Use the example controls to emit a Custom Event, API Request and error. In the Console, open **Events**, **API**, **Errors** and **Sessions** and confirm they share one `session_id`.

### Minimal React integration

```ts
// src/monitoring.ts
import { init } from "@openrum/browser";

export function startMonitoring() {
  init({
    endpoint: import.meta.env.VITE_OPENRUM_ENDPOINT,
    writeKey: import.meta.env.VITE_OPENRUM_WRITE_KEY,
    environment: import.meta.env.MODE,
    release: import.meta.env.VITE_APP_RELEASE,
  });
}
```

Call `startMonitoring()` once near the application entrypoint before rendering routes.

### Source Map upload

For mapped stack frames, add the Vite plugin and configure optional object storage. See [Source Maps](/docs/sdk/source-maps/).

## Other frameworks

Any browser application can use the same SDK:

1. Install `@openrum/browser`.
2. Call `init()` once on startup with endpoint, write key, Environment and Release.
3. Prefer automatic capture for Page Views, errors, API timing and Web Vitals.
4. Add governed Custom Events for business milestones only.

Do not send emails, phone numbers, payment data, authentication tokens or free-form user text. See [Browser SDK](/docs/sdk/browser/) and [Privacy](/docs/security/privacy/).
