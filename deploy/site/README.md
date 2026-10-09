# Static public-site deployment

`apps/site` is static and has no API dependency. Build it with the canonical production URL, repository URL, Release and commit:

```sh
PUBLIC_SITE_URL=https://openrum.dev \
PUBLIC_REPOSITORY_URL=https://github.com/open-rum/openrum \
PUBLIC_OPENRUM_RELEASE=Alpha \
PUBLIC_COMMIT_SHA=$(git rev-parse HEAD) \
pnpm site:build
```

The output is `apps/site/dist/`. Preview it locally with `pnpm --filter @openrum/site preview`. Upload the contents of `dist/` to a static-site host; no Docker image or application service is needed for the site. Configure hashed `/_astro/` assets for long-lived immutable caching and HTML for short-lived revalidation.

The `Public site` GitHub workflow retains every PR and main-branch build as a static artifact. A product release attaches a matching versioned static-site archive built from the tagged commit. Connect either artifact to the chosen static-site hosting/CD system; neither workflow currently deploys `openrum.dev`. DNS/TLS and the first external walkthrough remain manual release gates because this repository cannot verify them without the real host and tester.

Optional dogfooding must use a dedicated Project, document the captured fields, respect Do Not Track/local consent policy, and avoid advertising or third-party trackers. It is off by default.
