# OpenRUM public site

Static Astro + Starlight product pages and documentation. It does not depend on the OpenRUM API or Console authentication.

```sh
pnpm site:dev
pnpm site:build
pnpm site:check
```

Production builds set `PUBLIC_SITE_URL`, `PUBLIC_REPOSITORY_URL`, `PUBLIC_OPENRUM_RELEASE` and `PUBLIC_COMMIT_SHA`. The output is `apps/site/dist`; serve HTML with a short cache and hashed `/_astro/*` assets as immutable.

Pull requests build and retain a review artifact. Main-branch builds publish a deployable static-site container after the `public-site` GitHub Environment gate. DNS, the explicit open-source license and the first external adoption walkthrough remain launch-owner checks rather than facts inferred by CI.
