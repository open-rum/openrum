# Contributing to OpenRUM

Thank you for helping improve OpenRUM. Start with the published contributor guides:

- [Contribution process and review expectations](https://openrum.netlify.app/docs/contributing/) · [简体中文](https://openrum.netlify.app/zh/docs/contributing/)
- [Local development and validation commands](https://openrum.netlify.app/docs/getting-started/local-development/) · [简体中文](https://openrum.netlify.app/zh/docs/getting-started/local-development/)
- [Private vulnerability reporting](https://openrum.netlify.app/docs/self-hosting/security/vulnerability-reporting/) · [简体中文](https://openrum.netlify.app/zh/docs/self-hosting/security/vulnerability-reporting/)

## Before you start

1. Search existing Issues and pull requests before starting to avoid duplicate work.
2. Discuss nontrivial behavior, API/SDK contract, event schema, storage or deployment changes in an Issue first. Small bug fixes, typos and broken-link fixes can go straight to a pull request.
3. Never include secrets, credentials or production telemetry in Issues, pull requests or test fixtures.

## Commit and pull request conventions

OpenRUM uses [Conventional Commits](https://www.conventionalcommits.org/) for pull request titles (and commits merged into `main`) so changelogs and release automation stay accurate:

```text
<type>(<scope>): <short summary>
```

- **Common types**: `feat`, `fix`, `docs`, `refactor`, `perf`, `test`, `ci`, `chore`. Mark breaking changes with `!` (for example `feat(api)!: ...`) or a `BREAKING CHANGE:` footer.
- **Scopes map to release artifacts**:

| Scope | Typical paths | Affected release artifact |
| --- | --- | --- |
| `api`, `ingest`, `console`, `helm`, `migrations` | `services/`, `internal/`, `apps/web/`, `migrations/`, `deploy/helm/` | Product image & Helm Chart (`vX.Y.Z`) |
| `browser`, `protocol` | `packages/browser-sdk/`, `packages/protocol/` | `@openrum/browser` (`browser-vX.Y.Z`) |
| `sourcemap` | `packages/sourcemap/` | `@openrum/sourcemap` (`sourcemap-vX.Y.Z`) — and `@openrum/cli` when CLI bundling needs the change |
| `cli` | `packages/cli/` | `@openrum/cli` (`cli-vX.Y.Z`) |
| `site`, `docs` | `apps/site/`, `docs/` | Public docs site only — **no package release** (prefer `docs(site):` / `chore(site):` over `feat(site):`) |

- Work-in-progress commits on feature branches are fine, but **Squash and merge** is preferred when merging into `main` so each PR lands as one clean Conventional Commit.

## Pull request guidelines

- **Keep changes focused**: one pull request per problem. Do **not** bump package versions, `Chart.yaml`, `values.yaml` or SDK version constants in ordinary feature/fix pull requests.
- **Keep contracts and docs in sync**: update tests, types/schemas and user-facing copy together. Any public doc change under `apps/site/src/content/docs/docs/` must include a matching Simplified Chinese update under `apps/site/src/content/docs/zh/docs/` in the same pull request.
- **Validate locally before requesting review**:
  - Repository checks: `pnpm run check`
  - Public site & docs checks (when touching `apps/site/` or public docs): `pnpm run site:check`
  - Run focused Go / integration tests for backend, query or migration changes.
  - Record the exact commands and results in the pull request description.

## Versioning and releases (Maintainers)

- **Merging code does not publish a release**: merging into `main` runs CI and updates the documentation site preview/deploy, but does not publish container images, Helm Charts or npm packages.
- **Independent package versioning**: OpenRUM ships four independently versioned release targets:
  - Product (`vX.Y.Z`): container image + OCI Helm Chart
  - `@openrum/browser` (`browser-vX.Y.Z`)
  - `@openrum/sourcemap` (`sourcemap-vX.Y.Z`)
  - `@openrum/cli` (`cli-vX.Y.Z`)
- **Release only what changed**: for patch/minor updates, bump and release only the packages with user-facing changes rather than publishing empty versions of unchanged packages. Aligning all packages to the same version is optional and best reserved for milestone releases.
- **Breaking changes and upgrade levels**:
  - Mark breaking changes with `!` or `BREAKING CHANGE:` in the PR title/body, bump the minor version during `0.x` (major after `1.0`), and highlight upgrade and rollback steps at the top of the GitHub Release Notes.
  - Product releases bundle the Go services, Console (`apps/web`) and built-in Browser SDK into one image paired with the Helm Chart. Distinguish stateless/UI updates (direct `helm rollback`), additive Expand-First migrations (backward-compatible schema), and breaking changes (manual upgrade/backup steps required).
- **Separate release preparation**: run `pnpm release:status` to see which targets have unreleased commits, use `pnpm release:bump` in a dedicated release-preparation PR to update manifests and docs, merge it to `main`, and publish via tags. Contributors do not push release tags. See the [release runbook](docs/operations/releasing.md) for exact checklists and commands.
