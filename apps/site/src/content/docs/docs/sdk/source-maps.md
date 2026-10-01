---
title: Release and Source Maps
description: Upload private Source Maps from CI with a project upload token so minified errors map back to original source.
---

**Applies to:** Alpha.

A Source Map Artifact turns a minified stack frame such as `index-abc.js:1:48213` back into
`src/checkout/cart.ts:42:7`. OpenRUM keeps maps private: they are uploaded from CI to the
Instance's object storage and never deployed with your site.

:::note[Object storage is required]
Core monitoring works without object storage. Source Map upload and mapping need an OSS or
S3-compatible Bucket configured on the Instance; see [Object storage](/docs/self-hosting/object-storage/).
The Console's **Releases** page shows a banner when storage is not configured or unavailable.
:::

## Create an upload token

1. In the Console, open **Settings → Project → Onboarding** (`/projects/<id>/onboarding`).
2. In **Source Map upload tokens**, create a token named after the pipeline that uses it, such
   as `github-actions-storefront`. Only Owners and Admins can create or revoke tokens; other members can see the list.
3. Copy the secret (`orut_…`) immediately; it is shown only once. Store it as a CI secret named
   `OPENRUM_UPLOAD_TOKEN`.

A token belongs to one Project. It can create Releases, upload Artifacts and list them; it
cannot delete Releases or Artifacts, and it stops working as soon as it is revoked. The token
list shows when each token was last used, so an unused or leaked token is easy to revoke.

## Configure the Vite plugin

The plugin is not published to npm in the Alpha. Build it from an OpenRUM checkout and install
the directory into your application:

```sh
pnpm --filter @openrum/vite-plugin build
pnpm add -D /path/to/openrum/packages/vite-plugin
```

```ts title="vite.config.ts"
import { defineConfig } from "vite";
import { openRUMSourceMaps } from "@openrum/vite-plugin";

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

`build.sourcemap: "hidden"` makes Vite write `.map` files without adding
`sourceMappingURL` comments to the bundles. With `true`, the plugin removes those comments for you.

On every build the plugin:

1. Reads all `.map` files below the build output into memory and deletes them from the output
   before the first network request, so a failed upload never leaves maps in a deployable
   directory. It also strips `sourceMappingURL` comments from emitted `.js`, `.mjs`, `.cjs` and
   `.css` files.
2. Creates the Release, or reuses it when the same version and dist already exist.
3. Uploads up to four maps at a time through short-lived presigned URLs. Network errors, `5xx`
   and `429` responses are retried twice with exponential backoff; validation errors are not.
4. Prints a summary such as `3 uploaded, 12 skipped (unchanged), 0 failed` and fails the build
   if any file failed.

For builds that do not run through Vite, the `openrum-sourcemaps` CLI does the same work. It
reads `OPENRUM_BASE_URL`, `OPENRUM_PROJECT_ID`, `OPENRUM_RELEASE`, `OPENRUM_DIST`,
`OPENRUM_UPLOAD_TOKEN` and `OPENRUM_URL_PREFIX`, or the matching flags:

```sh
pnpm exec openrum-sourcemaps --out-dir dist --url-prefix static/app/
```

## Match the SDK Release and dist

Mapping looks up Artifacts by the `release` and `dist` on each error Event. Pass exactly the
same values to the plugin and to the browser SDK:

```ts title="src/monitoring.ts"
init({
  dsn: import.meta.env.VITE_OPENRUM_DSN,
  release: import.meta.env.VITE_APP_RELEASE, // same value as OPENRUM_RELEASE
});
```

An Event without a `release` cannot be mapped. A different `dist`, or a `dist` set on only one
side, points the lookup at a different Release.

## Artifact names and `urlPrefix`

An Artifact is matched by name. The name is the script URL path without scheme, host, query,
fragment or leading `/`, followed by `.map`. The plugin builds it from `urlPrefix` plus the
file's path relative to the build output directory.

| Script URL in the stack                                  | File in `dist`            | `urlPrefix`   | Artifact name                        |
| -------------------------------------------------------- | ------------------------- | ------------- | ------------------------------------ |
| `https://shop.example.com/assets/index-abc.js`           | `assets/index-abc.js.map` | none          | `assets/index-abc.js.map`            |
| `https://cdn.example.com/static/app/assets/index-abc.js` | `assets/index-abc.js.map` | `static/app/` | `static/app/assets/index-abc.js.map` |

Set `urlPrefix` whenever the site is served below a sub-path, for example when Vite `base` is
`/static/app/` or a CDN URL. Slashes are normalized and a full URL is reduced to its path. If
frames report `missing_artifact`, compare the frame URL path with the uploaded names first.

## Re-run builds and upload late

- **Re-running a build for the same Release is safe.** The Release is reused and a map with the
  same name and SHA-256 is skipped without being uploaded again.
- **A changed map needs a new Release.** A map with the same name but different contents fails
  with `ARTIFACT_EXISTS`. To overwrite deliberately, set `replace: true` or pass `--replace`.
- **Late uploads remap recent errors.** When an Artifact becomes ready, errors from the last
  7 days for that Release and dist that were not fully mapped are mapped again automatically.
  Older Events keep their generated frames.

Each map may be at most 64 MiB. The plugin rejects larger files before upload; split the bundle
into smaller chunks instead.

## Verify mapping

1. Open **Releases** in the main navigation and select the Release. Its badge shows how many
   Artifacts are ready out of those uploaded.
2. Use the match tester: enter a generated frame URL, line and column from a production error
   and confirm it resolves to the expected source file and line.
3. Trigger a known error in the deployed build and open it from **Issues**. A mapped stack keeps
   the generated frame and adds the original path, line and column. Frames that could not be
   mapped show the reason, such as `missing_artifact`.

If uploads fail or frames stay unmapped, see
[Troubleshooting](/docs/self-hosting/troubleshooting/#source-map-upload-fails).
