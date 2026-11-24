## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues using the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Domain docs

This repository uses a single-context domain layout. See `docs/agents/domain.md`.

### Public documentation

Before changing public documentation or its presentation, read
`docs/agents/public-docs.md`. Prefer Astro and Starlight's native content components
and split long tutorials into task-focused pages with collapsible sidebar groups.

Every public page under `apps/site/src/content/docs/docs` must have a complete
Simplified Chinese counterpart at the same relative path under
`apps/site/src/content/docs/zh/docs`, and vice versa. Add or update both languages
in the same change. Chinese internal links use `/zh/docs/`; English links use
`/docs/`. Public applicability labels describe product stages or released versions,
never internal branch names such as `main`. The site content tests enforce path
parity, localized links, and this public-version boundary.

### Console UI

The Console (`apps/web`) uses daisyUI 5. Before changing any Console component, page style,
theme, colour, radius or spacing, read `docs/agents/console-ui.md` and load the `daisyui`
skill. The public site and docs keep `docs/design.md` and `packages/design-tokens`.

### Time-series charts

Before changing Console trend charts, aggregation intervals, point budgets,
missing buckets, chart axes, or related query/cache code, read
`docs/agents/time-series.md`. Use the shared approximately-30-point policy;
do not introduce page-specific density rules. This applies to both frontend
and backend work, not only the project overview.

### Rate limits

Before changing Ingest rate limits, Project limit settings, 429 behavior, or related documentation, read `docs/agents/rate-limits.md`.

### Alerts

Before changing alert rules, evaluation, delivery, notification channels, or the Alerts and Notification channels pages, read `docs/agents/alerts.md`.

### Storage pressure

Before changing ClickHouse capacity thresholds, emergency sampling, hard-stop behavior, or emergency cleanup, read `docs/agents/storage-pressure.md`.

### API header capture

Before changing which HTTP headers an API Request may carry, the capture rules or their Console page, the SDK's header reading, or how long stored headers live, read `docs/agents/api-capture.md`.

### Releases and commits

Before bumping versions, preparing a release, pushing release tags, or writing PR titles and release notes, read `docs/agents/releases.md`. Never bump package or Chart versions in ordinary feature/fix PRs; use `pnpm release:status` and `pnpm release:bump` in a dedicated release-preparation PR, release only changed targets by default, and push annotated tags from `main` in order (`browser-v*`, `sourcemap-v*`, `cli-v*`, `v*`).

### Tests

Do not add Playwright end-to-end tests (`tests/e2e`) unless the user explicitly asks for them. Cover new behavior with unit, component and integration tests instead. Existing e2e specs stay as they are unless the user asks to change them.
