# Public-site deployment

`apps/site` is static and has no API dependency. Build it with the canonical production URL, repository URL, Release and commit:

```sh
PUBLIC_SITE_URL=https://openrum.dev \
PUBLIC_REPOSITORY_URL=https://github.com/openrum/openrum \
PUBLIC_OPENRUM_RELEASE=Alpha \
PUBLIC_COMMIT_SHA=$(git rev-parse HEAD) \
pnpm site:build

docker build -f deploy/site/Dockerfile -t openrum-site:local .
docker run --rm -p 4321:8080 openrum-site:local
```

The nginx image gives hashed `/_astro/` assets a one-year immutable cache and HTML a five-minute revalidation cache. `/health/ready` is suitable for a container readiness probe.

The `Public site` GitHub workflow retains every PR build as an immutable review artifact and publishes main-branch containers to GHCR after the `public-site` Environment gate. Connect that immutable SHA tag to the chosen runtime/CD system; do not deploy the moving `main` tag directly. DNS/TLS and the first external walkthrough are manual release gates because this repository cannot verify them without the real host and tester.

Optional dogfooding must use a dedicated Project, document the captured fields, respect Do Not Track/local consent policy, and avoid advertising or third-party trackers. It is off by default.
