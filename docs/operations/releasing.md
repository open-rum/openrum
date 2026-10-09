# Publishing an OpenRUM release

This is the product release path, not an automatic deployment to a customer's Kubernetes cluster or to `openrum.dev`. The tagged release publishes an application image, an OCI Helm Chart, a versioned static documentation archive, and finally a GitHub Release. The operator decides when to install the Chart. The documentation website is deployed separately from the connected `main` branch by Netlify; the release workflow does not deploy the versioned archive.

Architecture diagrams are committed SVG assets edited directly. Preview and release workflows build from the committed asset; they do not start a headless browser or rerender the diagram. Browser E2E remains an opt-in job in the standalone CI workflow, not a release gate.

The Chart and release workflow are pinned to `ghcr.io/open-rum`. Before tagging, use the dry runs described below: **Publish release** and **Publish browser SDK** both validate everything without pushing an image, package or tag.

## One-time GitHub setup

1. Run the release workflow in the official `open-rum/openrum` repository. It deliberately will not publish from a fork.
2. Grant Actions package write access, and make the `ghcr.io/open-rum/openrum` and `ghcr.io/open-rum/charts/openrum` packages public before telling readers that they can install anonymously.
3. Configure the `public-release` GitHub Environment with required reviewers. The workflow names this environment, but GitHub will not require approval unless the repository configures protection rules.
4. Protect `v*` tags against updates and deletion in repository rulesets; a published tag must keep naming the same commit.
5. The current test documentation site is built by Netlify from `main` at `openrum.netlify.app`. Before an official launch, connect the official repository, set the intended canonical domain and verify a production deployment. The tagged documentation archive is release evidence, not a Netlify deployment input; building it alone does not update `openrum.dev`.

## Prepare a version

Make one release-preparation PR that updates `deploy/helm/openrum/Chart.yaml` (`version` and `appVersion`), `deploy/helm/openrum/values.yaml` (`image.tag`), the public Chinese and English documentation, and any release notes. The product version uses `vX.Y.Z` Git tags; the Chart and image omit the leading `v`. The Browser SDK has its own version and is published by a separate workflow; see [Publish the browser SDK](#publish-the-browser-sdk).

Keep the docs for unreleased features in review until the corresponding artifact is published. The current public docs site shows one current version; the versioned static archive preserves the exact docs built from each tag, but the site does not yet serve archived versions at separate URLs.

Run normal CI on the PR, then use **Publish release → Run workflow** with a version such as `v0.1.1` to run the full release validation without publishing. The dry run checks the version contract, renders and packages the Chart, builds the documentation from the candidate commit, and retains both artifacts for inspection. It does not push images, Chart packages, tags, GitHub Releases, or production deployments.

## Publish

After the release-preparation PR is merged and the commit is approved, create and push an immutable tag:

```sh
git tag -a v0.1.1 -m "OpenRUM v0.1.1"
git push origin v0.1.1
```

`Publish release` then reuses the main CI checks, validates that the tag points to a commit on `main`, checks all Chart/image versions, and runs Helm lint/template plus documentation build/link checks. Only after those checks pass does the `public-release` job:

1. Build and publish `ghcr.io/open-rum/openrum:0.1.1` for amd64 and arm64, then inspect the published image.
2. Push `openrum-0.1.1.tgz` to `oci://ghcr.io/open-rum/charts`, then pull its metadata back.
3. Attach the static docs archive built from the same commit to the GitHub Release. The current Netlify site deploys from its connected branch, not from this archive.
4. Create the GitHub pre-release with generated notes only after the artifacts have been published.

Do not move or republish a public version tag. If publication fails partway through, inspect which versioned artifacts exist before retrying; use a new patch/prerelease version when their contents might differ. Publishing does not run `helm upgrade` against any cluster.

The mutable Docker registry cache entry only stores intermediate build layers across release tags. It is not an installable product version and must not be used in Helm values.

## Publish the browser SDK

`@openrum/browser` is the only npm package. It is versioned independently of the product, so an SDK fix does not need a Chart or image release.

One-time setup:

1. The `openrum` organization on npmjs.com owns the `@openrum` scope.
2. Create an npm automation (or granular, publish-only, `@openrum`-scoped) access token and store it as the `NPM_TOKEN` secret of the `public-release` GitHub Environment, the same environment that gates the product release. Once the package exists, switch the publish step to npm Trusted Publishing and delete the token.
3. Run the workflow in the official `open-rum/openrum` repository; like the product release it will not publish from a fork.

To release:

1. Bump `version` in `packages/browser-sdk/package.json`, update the SDK docs, and merge to `main`.
2. Use **Publish browser SDK → Run workflow** with a tag such as `browser-v0.1.1` for a dry run. It checks the tag against the package version, runs lint, type check, tests and the build, then packs the tarball and installs it into an empty project to import it and type-check against it. That last step is what catches a private workspace dependency leaking into the published package. A dry run never publishes.
3. Push the tag:

```sh
git tag -a browser-v0.1.1 -m "@openrum/browser 0.1.1"
git push origin browser-v0.1.1
```

The workflow refuses an existing npm version, publishes with provenance (only while the repository is public; npm cannot sign provenance for a private repository), and reads the version back from the registry. A plain version publishes under `latest`; a prerelease such as `browser-v0.1.1-alpha.1` publishes under `next`, so `npm install @openrum/browser` never picks it up. npm does not allow republishing a version, so fix a bad release with a new patch version.

## Deploy separately

An operator can install or upgrade the versioned Chart with environment-specific values:

```sh
helm upgrade --install openrum oci://ghcr.io/open-rum/charts/openrum \
  --version 0.1.1 \
  --namespace openrum --create-namespace \
  --values values.production.yaml \
  --wait --timeout 15m
```

Before production use, follow the [upgrade](upgrades.md), [backup and restore](backup-restore.md), and public [Kubernetes installation](/docs/self-hosting/kubernetes/) guides. The migration Job runs before application Pods roll, so publishing a package and deploying it are deliberately separate decisions. Publishing a tagged documentation archive does not update the Netlify site or `openrum.dev`; those follow the static site's own deployment configuration.
