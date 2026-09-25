---
title: Release and Source Maps
description: Upload private Source Map Artifacts with the Vite plugin.
---

Object storage is optional for core monitoring and required for Source Map mapping.

```sh
pnpm add -D @openrum/vite-plugin
```

```ts
import { defineConfig } from "vite";
import { openRUMSourceMaps } from "@openrum/vite-plugin";

export default defineConfig({
  build: { sourcemap: true },
  plugins: [openRUMSourceMaps({
    baseUrl: process.env.OPENRUM_API_URL!,
    projectId: process.env.OPENRUM_PROJECT_ID!,
    release: process.env.OPENRUM_RELEASE!,
    sessionCookie: process.env.OPENRUM_SESSION!,
    csrfToken: process.env.OPENRUM_CSRF_TOKEN!,
  })],
});
```

The Alpha plugin creates a Release, requests a short-lived upload grant, verifies Artifact metadata, and removes `.map` files from the public build before making a network request. Keep the Console session and CSRF values in CI secrets. A dedicated upload token is not supported in this version.

To verify, trigger a known minified error for the same Release and use the Issue detail Source Map diagnostic. A successful mapping preserves the raw frame and adds the original source path, line and column.
