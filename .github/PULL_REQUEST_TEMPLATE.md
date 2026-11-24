## Problem and related Issue

<!-- What problem does this solve? Link the Issue, or explain why this is a small direct fix. -->

## Change

<!-- Describe user-visible behavior and relevant API, SDK, schema or configuration changes. -->

## Affected release targets

<!-- Ordinary PRs should NOT bump version numbers. Mark which release artifacts are affected so maintainers know what to release later. -->

- [ ] Product (`v*` — container image & Helm Chart)
- [ ] `@openrum/browser` (`browser-v*`)
- [ ] `@openrum/sourcemap` (`sourcemap-v*`)
- [ ] `@openrum/cli` (`cli-v*`)
- [ ] None (docs, public site, tests or CI only)

## Upgrade and breaking impact (Product / Helm)

<!-- Select what applies when changing services, Console, migrations or Helm values. -->

- [ ] Stateless / UI only (safe direct `helm rollback`)
- [ ] Additive database migration (Expand First; compatible with N-1 application rollback)
- [ ] Breaking change (uses `!` / `BREAKING CHANGE:` and requires explicit upgrade steps in Release Notes)
- [ ] Not applicable

## Verification

<!-- List exact commands and results. Explain relevant checks not run. -->

## Review notes

<!-- Add UI screenshots when applicable. Describe privacy, compatibility, migration, rollout and rollback implications, or mark them not applicable. Confirm matching English and Simplified Chinese public docs when changed. -->
