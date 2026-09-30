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
