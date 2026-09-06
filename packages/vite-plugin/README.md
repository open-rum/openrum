# `@openrum/vite-plugin`

Vite build plugin and CLI for creating an OpenRUM Release and uploading private Source Map Artifacts.

The current Alpha upload API uses a short-lived authenticated Console session plus CSRF token. Run uploads only in a trusted CI runner. A dedicated project upload token is planned but is not a shipped API.

```ts
import { openRUMSourceMaps } from "@openrum/vite-plugin";
import { defineConfig } from "vite";

export default defineConfig({
  build: { sourcemap: true },
  plugins: [
    openRUMSourceMaps({
      baseUrl: process.env.OPENRUM_BASE_URL!,
      projectId: process.env.OPENRUM_PROJECT_ID!,
      release: process.env.OPENRUM_RELEASE!,
      commitSha: process.env.GITHUB_SHA,
      sessionCookie: process.env.OPENRUM_SESSION!,
      csrfToken: process.env.OPENRUM_CSRF_TOKEN!,
    }),
  ],
});
```

The plugin discovers `.map` files below `outDir` (`dist` by default), reads them into memory, removes them from the public output before the first network request, creates a Release, uploads each artifact through a presigned URL and marks it complete. Build failure therefore does not leave Source Maps in the public directory.

The CLI uses the same implementation:

```sh
OPENRUM_BASE_URL=https://rum.example.com \
OPENRUM_PROJECT_ID=00000000-0000-4000-8000-000000000000 \
OPENRUM_RELEASE=storefront@1.8.0 \
OPENRUM_SESSION=... \
OPENRUM_CSRF_TOKEN=... \
pnpm exec openrum-sourcemaps --out-dir dist
```

Object storage must be configured for Source Map Artifacts. Core event ingestion and queries continue to work without it.
