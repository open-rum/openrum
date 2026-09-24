# Publishing an OpenRUM release

This is the product release path, not an automatic deployment to a customer's Kubernetes cluster or to `openrum.dev`. The tagged release publishes an application image, an OCI Helm Chart, a versioned documentation-site image and archive, and finally a GitHub Release. The operator decides when to install the Chart; the public-site runtime/CD integration is not configured yet.

## Private package test before the official repository is available

The private `eijil/openrum` repository has a separate **Publish private package test** manual workflow. It runs formatting, basic lint, type checks, unit tests, builds, and site checks before building the application image, documentation image, and a copy of the Helm Chart whose defaults point to the private test image. The unique `0.1.0-test.<run>.<attempt>` version appears in all three artifacts under `ghcr.io/eijil`; inspect the workflow run for the exact version. It does not create a Git tag or GitHub Release, make packages public, deploy the site, or install anything in Kubernetes. This smoke gate is deliberately separate from full CI: a successful private package test is not a claim that Go lint, integration tests, or browser E2E pass.

Architecture diagrams are committed SVG assets. When changing a source under `docs/diagrams/`, run `pnpm docs:generate` locally and commit the updated SVG. Preview and release workflows build from the committed asset; they do not start a headless browser, rerender the diagram, or compare SVG bytes. Browser E2E remains an opt-in job in the standalone CI workflow, not a release gate.

The official Chart and release workflow remain pinned to `ghcr.io/openrum`. Testing under a personal namespace does not change the production release address. Private package consumers must authenticate to GHCR before pulling images or the OCI Chart. When the official `openrum` organization grants publishing access, use the normal release path below and retire the personal test workflow.

## One-time GitHub setup

1. Run the release workflow in the official `openrum/openrum` repository. It deliberately will not publish from a fork.
2. Grant Actions package write access, and make the `ghcr.io/openrum/openrum`, `ghcr.io/openrum/charts/openrum` and `ghcr.io/openrum/openrum-site` packages public before telling readers that they can install anonymously.
3. Configure the `public-release` GitHub Environment with required reviewers. The workflow names this environment, but GitHub will not require approval unless the repository configures protection rules.
4. Protect `v*` tags against updates and deletion in repository rulesets; a published tag must keep naming the same commit.
5. Choose the site runtime/CD system and connect it to the immutable `ghcr.io/openrum/openrum-site:<version>` tag. Publishing the image alone does not update `openrum.dev`.

## Prepare a version

Make one release-preparation PR that updates `deploy/helm/openrum/Chart.yaml` (`version` and `appVersion`), `deploy/helm/openrum/values.yaml` (`image.tag`), the public Chinese and English documentation, and any release notes. The product version uses `vX.Y.Z` Git tags; the Chart and image omit the leading `v`. Browser SDK/npm packages have their own version and publication lifecycle and are not published by this workflow.

Keep the docs for unreleased features in review until the corresponding artifact is published. The current public docs site shows one current version; the versioned site image and static archive preserve the exact docs built from each tag, but the site does not yet serve archived versions at separate URLs.

Run normal CI on the PR, then use **Publish release → Run workflow** with a version such as `v0.1.0` to run the full release validation without publishing. The dry run checks the version contract, renders and packages the Chart, builds the documentation from the candidate commit, and retains both artifacts for inspection. It does not push images, Chart packages, tags, GitHub Releases, or production deployments.

## Publish

After the release-preparation PR is merged and the commit is approved, create and push an immutable tag:

```sh
git tag -a v0.1.0 -m "OpenRUM v0.1.0"
git push origin v0.1.0
```

`Publish release` then reuses the main CI checks, validates that the tag points to a commit on `main`, checks all Chart/image versions, and runs Helm lint/template plus documentation build/link checks. Only after those checks pass does the `public-release` job:

1. Build and publish `ghcr.io/openrum/openrum:0.1.0` for amd64 and arm64, then inspect the published image.
2. Push `openrum-0.1.0.tgz` to `oci://ghcr.io/openrum/charts`, then pull its metadata back.
3. Publish `ghcr.io/openrum/openrum-site:0.1.0` from the same commit and attach the static docs archive to the GitHub Release.
4. Create the GitHub pre-release with generated notes only after the artifacts have been published.

Do not move or republish a public version tag. If publication fails partway through, inspect which versioned artifacts exist before retrying; use a new patch/prerelease version when their contents might differ. Publishing does not run `helm upgrade` against any cluster.

## Deploy separately

An operator can install or upgrade the versioned Chart with environment-specific values:

```sh
helm upgrade --install openrum oci://ghcr.io/openrum/charts/openrum \
  --version 0.1.0 \
  --namespace openrum --create-namespace \
  --values values.production.yaml \
  --wait --timeout 15m
```

Before production use, follow the [upgrade](upgrades.md), [backup and restore](backup-restore.md), and public [Kubernetes installation](/docs/self-hosting/kubernetes/) guides. The migration Job runs before application Pods roll, so publishing a package and deploying it are deliberately separate decisions. The documentation-site image likewise needs an external deployment action to update `openrum.dev`.
