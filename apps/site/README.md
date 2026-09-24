# OpenRUM public site

Static Astro + Starlight product pages and documentation. It does not depend on the OpenRUM API or Console authentication.

```sh
pnpm site:dev
pnpm site:build
pnpm site:check
```

Production builds set `PUBLIC_SITE_URL`, `PUBLIC_REPOSITORY_URL`, `PUBLIC_OPENRUM_RELEASE` and `PUBLIC_COMMIT_SHA`. The output is `apps/site/dist`; serve HTML with a short cache and hashed `/_astro/*` assets as immutable.

Pull requests and main-branch changes build and retain a static-site artifact. A tagged product release also attaches a versioned archive. Deploy the built files through the chosen static-site host; the repository does not publish a documentation container or deploy `openrum.dev` automatically. DNS, the explicit open-source license and the first external adoption walkthrough remain launch-owner checks rather than facts inferred by CI.
