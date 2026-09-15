# Personal project dashboards

The project overview is a personal dashboard keyed by the authenticated user and
project. Viewers can edit their own configuration. The ordinary overview route
loads the default layout until the user saves a customization.

## Adding a bundled module

Register the module in `registry.tsx`. A definition supplies its configuration
schema/version, defaults, allowed sizes and views, data adapter, renderer and
editor. Keep project queries in this feature; `packages/ui` owns reusable chart
and UI primitives, and `packages/design-tokens` owns theme values.

For a new query capability, extend `model.ts`, `queries.ts`, and the Go allowlist
in `internal/metadata/dashboard_config.go` together. Existing source adapters
reuse Overview and Events API responses. Configuration is JSON only: no scripts,
remote module URLs, raw SQL, or arbitrary property aggregation.

- `stat`: one range-wide aggregate, with backend comparisons where available.
- `timeseries`: one metric, or the built-in PV/UV or stability pair. Views are
  Area, Line, and Bar; the second series in Area remains a line, without stacking.
- `breakdown`: one event metric grouped by country, device, browser, source or
  custom property; Top 10 horizontal bars or a table. Country breakdowns also
  support `map`, rendering all returned groups (not Top 10) with the bundled
  world-atlas SVG. Only country queries have a 250-group budget; other dimensions
  retain 100. Country IDs are matched using ISO codes, not translated names.
  Unreturned countries are neutral, not zero. Unknown/unmapped groups remain
  disclosed and available in the detail table. Hover, keyboard focus and touch
  expose values; small regions receive a centroid marker. Map code and geometry
  load lazily. Changing to a non-country dimension falls back to Bar.
- `top-issues` / `slow-apis`: existing lists with current filters in drill-down links.

## Data and layout contracts

Global time and environment apply to all modules. Release and route belong to
Overview modules. Legacy URL release/route filters override module settings
temporarily and are labeled in the UI; they never enter saved configuration.
Events do not support those filters. Custom property names group events by the
property value; they are not numeric metrics.

Query keys include user, project, source and effective query filters. Titles,
view types, selected response fields and dimensions of cards do not affect a
query key. Identical queries share one observer result, with six simultaneous
requests across the dashboard and configuration preview. All adapters take UV,
rates and P75 directly from backend aggregates. Missing rates and percentiles
remain null; sample and approximation notes remain available in the details dialog. Event Stat modules
do not fabricate previous-period comparisons.

In viewing mode cards show a title and primary value/chart. Stat cards place a
left-aligned comparison badge and "较上一周期" below the number, followed by one
short metric description. Reserve the top-right for the details icon, without
a competing comparison badge. Rising traffic is positive; rising errors/failures or
Web Vitals is negative. Unavailable comparisons, rounded-zero changes and
insufficient samples stay neutral. A hover/focus details button opens a Dialog;
the button remains visible on touch/narrow screens. The dialog reuses loaded
data for current/previous values, time range, freshness, statistical notes,
trends and exact-value tables. Do not restore inline "查看数据表" disclosures.
Configured table modules remain tables. Delayed-data dots stay visible in the
title, while full receive timestamps live in details. Edit controls stay in edit
mode, and opening details never changes or saves the configuration.

At most 24 modules are allowed. Array order is visual and keyboard order. CSS
Grid uses 12 desktop columns: Stat 3/6, charts and lists 6/12. Tablet uses two
columns, mobile one. There are no free coordinates, per-widget time ranges,
custom colors, multiple saved dashboards or shared/public dashboards in v1.

## Persistence and rollout

Apply PostgreSQL migration `0016_personal_dashboards` before starting the new
API. No ClickHouse or SDK migration is required.

`GET /api/v1/projects/{projectId}/overview/config` returns
`{ config, revision, updatedAt }`. An unsaved dashboard returns `config: null`,
`revision: 0`, and `updatedAt: null`.

`PUT` on the same route accepts `{ config, revision }`, where config contains
`{ schemaVersion: 1, widgets: [...] }`. Each widget has an instance `id`, registered
`type`, module `version`, `title`, `size`, `view`, and `data`. The server derives the
owner from the session, requires project membership and CSRF, and rejects stale
revisions with `409 CONFIG_VERSION_CONFLICT`. Membership remains locked through
the database write. Config responses are private and never HTTP-cached.

Edits stay in memory until Save; Cancel discards them, and Reset replaces the
draft with defaults. A save conflict preserves the draft until the user chooses
to reload. Unknown module types/versions render a placeholder and may be
retained unchanged or removed. Unsupported document schema versions disable
editing to prevent destructive downgrades.

## Manual acceptance

- Add event Stat, trend and dimension modules; configure exact event names and
  properties, including names without data in the selected range.
- Duplicate a chart, change Area/Line/Bar, then reorder and resize it. Its query
  is reused, and chart gradients remain independent.
- Save, refresh and open another device. Cancel and Reset should affect only
  the current user's project layout. A second stale save should preserve its
  draft and show a conflict.
- Check viewer access, a removed membership, another user and another project;
  personal configuration cannot cross those boundaries.
- Verify empty/insufficient samples, null values and a failed query, then check
  mobile layout, both themes, keyboard movement and accessible chart tables.
- Follow issue/API links and legacy filtered overview links. Check that event
  modules never claim to apply release or route filters.
