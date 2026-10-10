# `@openrum/sourcemap`

Uploads private Source Map Artifacts from a build to an OpenRUM Release, so errors from minified bundles map back to original source. It is a library (`uploadSourceMaps`) and a Vite plugin (`@openrum/sourcemap/vite`). For builds that do not run through Vite, such as Next.js, use the command line in [`@openrum/cli`](../cli), which runs this same code.

The package is not published to npm yet. Build it from an OpenRUM checkout with `pnpm --filter @openrum/sourcemap build` and install that directory into your application.

## Authentication

Create a **Source Map upload token** in the Console under **Settings → Project → Onboarding → Source Map upload tokens** and store it as a CI secret named `OPENRUM_UPLOAD_TOKEN`. The secret (`orut_…`) is shown once. A token belongs to one Project and can only create Releases, upload Artifacts and list them; it cannot delete anything and can be revoked at any time.

The earlier `sessionCookie` / `csrfToken` options still work but are deprecated and print a warning. Replace them with a token.

## Vite plugin

```ts
import { openRUMSourceMaps } from "@openrum/sourcemap/vite";
import { defineConfig } from "vite";

export default defineConfig({
  build: { sourcemap: "hidden" },
  plugins: [
    openRUMSourceMaps({
      baseUrl: process.env.OPENRUM_BASE_URL!,
      projectId: process.env.OPENRUM_PROJECT_ID!,
      release: process.env.OPENRUM_RELEASE!,
      commitSha: process.env.GITHUB_SHA,
      // token defaults to process.env.OPENRUM_UPLOAD_TOKEN
    }),
  ],
});
```

`release` (and `dist`, when used) must equal the values passed to the browser SDK `init()`.

| Option        | Default                | Purpose                                                                |
| ------------- | ---------------------- | ---------------------------------------------------------------------- |
| `baseUrl`     | required               | OpenRUM API origin, for example `https://rum.example.com`.             |
| `projectId`   | required               | Project ID.                                                            |
| `release`     | required               | Release version; must match the SDK.                                   |
| `dist`        | `""`                   | Dist; must match the SDK.                                              |
| `commitSha`   | `""`                   | Commit recorded on the Release.                                        |
| `token`       | `OPENRUM_UPLOAD_TOKEN` | Source Map upload token, sent as `Authorization: Bearer`.              |
| `outDir`      | Vite `build.outDir`    | Directory scanned for `.map` files.                                    |
| `urlPrefix`   | `""`                   | URL path placed before each file's path relative to `outDir`.          |
| `replace`     | `false`                | Overwrite an uploaded map with the same name but different contents.   |
| `concurrency` | `4`                    | Parallel uploads.                                                      |
| `retries`     | `2`                    | Retries for network errors, `5xx` and `429`, with exponential backoff. |

## What a build does

1. Finds every `.map` file below `outDir`, reads it into memory, and deletes it from the build output before the first network request. Maps are never left in a deployable directory, even when the upload fails.
2. Removes `//# sourceMappingURL=…` and `/*# sourceMappingURL=… */` comments from emitted `.js`, `.mjs`, `.cjs` and `.css` files, so deployed files do not reference the removed maps.
3. Creates the Release. This is idempotent: re-running a build for an existing Release and dist reuses it.
4. Uploads up to four maps at a time through short-lived presigned URLs, then marks each one complete. A map the server already stores with the same SHA-256 is skipped.
5. Prints a summary such as `3 uploaded, 12 skipped (unchanged), 0 failed` and fails the build when any file failed.

Validation errors (`4xx`) are never retried. Maps larger than 64 MiB are rejected before upload.

## Artifact names

An Artifact name is the script URL path, without scheme, host, query or leading `/`, plus `.map`. The plugin builds it as `urlPrefix` + the file's path relative to `outDir`.

| Script URL                                               | `outDir` file             | `urlPrefix`   |
| -------------------------------------------------------- | ------------------------- | ------------- |
| `https://example.com/assets/index-abc.js`                | `assets/index-abc.js.map` | none          |
| `https://cdn.example.com/static/app/assets/index-abc.js` | `assets/index-abc.js.map` | `static/app/` |

If Vite `base` is a sub-path or CDN URL, set `urlPrefix` to its path. A full URL is accepted and reduced to its path.

## Changed maps for an existing Release

When a map with the same name but different contents is already uploaded, that file fails with `ARTIFACT_EXISTS`. Use a new Release for a changed build. To overwrite deliberately, set `replace: true` or pass `--replace`.

## Command line and library use

`openrum sourcemaps upload` in [`@openrum/cli`](../cli) runs the same implementation, with the same options as flags and environment variables. To call it from your own script, import it from the package root:

```ts
import { uploadSourceMaps } from "@openrum/sourcemap";

await uploadSourceMaps({
  baseUrl: "https://rum.example.com",
  projectId: "00000000-0000-4000-8000-000000000000",
  release: "storefront@1.8.0",
  outDir: "dist",
});
```

The same options as the plugin apply, and `outDir` is required when you are not inside a Vite build.

Object storage must be configured on the Instance for Source Map Artifacts. Core event ingestion and queries continue to work without it.
