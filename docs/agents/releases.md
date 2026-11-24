# Releases and commits

Follow these rules whenever committing changes, opening pull requests, bumping versions or publishing releases. The full human-facing runbook lives in `docs/operations/releasing.md`.

## Ordinary changes (not a release)

1. **Never bump release versions in ordinary PRs.** Do not touch `deploy/helm/openrum/Chart.yaml`, `deploy/helm/openrum/values.yaml`, `packages/*/package.json`, `SDK_VERSION`, `OPENRUM_BROWSER_SDK_VERSION`, `services/api/internal/handlers/browser_sdk.go` or versioned doc strings when fixing bugs or shipping features.
2. **Use Conventional Commits for PR titles and commits merged to `main`**: `<type>(<scope>): <short summary>`.
   - Common types: `feat`, `fix`, `docs`, `refactor`, `perf`, `test`, `ci`, `chore`.
   - Mark breaking changes with `!` (e.g. `feat(api)!: ...`) or a `BREAKING CHANGE:` footer.
   - Align `scope` with release targets:
     - `api`, `ingest`, `console`, `helm`, `migrations` -> Product (`vX.Y.Z`)
     - `browser`, `protocol` -> `@openrum/browser` (`browser-vX.Y.Z`)
     - `sourcemap` -> `@openrum/sourcemap` (`sourcemap-vX.Y.Z`)
     - `cli` -> `@openrum/cli` (`cli-vX.Y.Z`)
     - `site`, `docs` -> Public site only (prefer `docs(site):` / `chore(site):` over `feat(site):`)
3. **Fill in `.github/PULL_REQUEST_TEMPLATE.md`**: check both **Affected release targets** and **Upgrade and breaking impact** (stateless/UI only, additive Expand-First migration, or breaking change).
4. **Prefer Squash and merge** into `main` so each PR lands as one clean Conventional Commit.

## Independent release targets

OpenRUM publishes four independently versioned targets:

| Target    | Tag format        | Published artifact                                                        |
| --------- | ----------------- | ------------------------------------------------------------------------- |
| Product   | `vX.Y.Z`          | `ghcr.io/open-rum/openrum` (Go services + Console `apps/web` + built-in SDK) & OCI Helm Chart |
| Browser   | `browser-vX.Y.Z`  | `@openrum/browser` on npm                                                 |
| SourceMap | `sourcemap-vX.Y.Z`| `@openrum/sourcemap` on npm                                               |
| CLI       | `cli-vX.Y.Z`      | `@openrum/cli` on npm                                                     |

- **Release only what changed** by default. Only align all four targets to the same version when the user explicitly requests a full/milestone release.
- **Console changes (`apps/web`) ship inside the Product image**, so delivering Console changes requires a Product (`vX.Y.Z`) release, whereas public-site changes (`apps/site`) deploy independently via Netlify and need no tag.
- **Breaking changes**: bump `minor` during `0.x` (`major` after `1.0`), call out upgrade and rollback steps at the top of the GitHub Release notes, and never rely on `helm rollback` to revert schema migrations.

## Release preparation and tagging procedure

Always execute releases through this exact sequence:

1. **Inspect unreleased changes per target** on clean `main`:
   ```sh
   pnpm release:status
   ```
2. **Bump versions with the helper script** instead of editing scattered files manually (preview with `--dry-run` first when unsure):
   ```sh
   pnpm release:bump --product 0.1.4 --browser 0.1.4
   # or --all <version> / patch / minor
   ```
   This updates manifests, Go/TS constants and bilingual docs, runs `scripts/docs/generate-reference.mjs`, runs `check-version.mjs` / `check-package-version.mjs`, and prints the exact tag commands.
3. **Validate locally before opening the release-prep PR**:
   - `pnpm run check`
   - `pnpm run site:check`
   - `node --test scripts/release/*.test.mjs`
   - For each bumped npm package: `node scripts/release/verify-package.mjs <package-directory>`
   - Do not modify `tests/e2e/*` unless the user explicitly asks.
4. **Merge the release-prep PR to `main` first**, wait for all required PR CI checks (`quality`, `integration`, `preview`) to pass, merge, then `git checkout main && git pull origin main`.
5. **Create and push annotated tags from `main` one at a time** in this order (so npm packages exist before the Product release announces them):
   - `browser-vX.Y.Z`
   - `sourcemap-vX.Y.Z`
   - `cli-vX.Y.Z`
   - `vX.Y.Z`
   Never create tags through the GitHub Web Release UI (`release.yml` fails if a Release already exists), and never delete, move or republish an existing public version tag.
6. **Verify triggered workflows**: inspect the GitHub Actions runs (`Publish browser SDK`, `Publish CLI and Source Map packages`, `Publish release`) and report their links and status (including if `public-release` environment approval is pending).

## Public site and Netlify builds

`netlify.toml` defines `build.ignore` so commits that do not touch site inputs skip Netlify deploys. Whenever a new repository path becomes an input to `pnpm site:build`, update both `.github/workflows/ci.yml` (`site` filter) and `netlify.toml` together.
