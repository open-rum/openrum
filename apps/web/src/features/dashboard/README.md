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
  Optional `statAppearance`: `plain` (also the default when omitted),
  `line-right` or `bar-right`. Configure it through the card's
  hover menu → Configure → Card appearance, then Apply and Save the dashboard.
  The right layout pairs the number with a small smooth line or rounded bar chart.
  Retired `line-bottom` / `area-bottom` records normalize to `line-right` during
  validation/read, without rewriting storage automatically. The Go allowlist
  retains those old values for existing records and rolling upgrades, but the
  editor only offers the three current appearances.
  `StatTrend.tsx` renders the same real
  Overview/Events buckets as details, without additional requests or fake data.
  Missing points remain gaps, a single valid point stays visible, and empty
  series show an explicit no-trend message. Mini charts are display-only: no
  tooltip, active point, pointer events or keyboard focus. Enlarge/details keeps
  interactive charts and the accessible exact-value table. Themes and
  reduced-motion preferences apply. No UV bucket sums or averaged P75 values.
- `timeseries`: one metric, or the built-in PV/UV or stability pair. Views are
  Area, Line, and Bar; the second series in Area remains a line, without stacking.
- `breakdown`: one event metric grouped by country, device, browser, source or
  custom property; Top 10 ranked bars, a table, or a `donut` ring/list view.
  `CategoryRanking.tsx` replaces numeric axes with always-visible category names,
  existing client metadata icons, exact counts and shares above thin horizontal
  bars. Bars compare against the maximum; shares use all returned groups, even
  when the compact card shows only ten. Long lists scroll with keyboard access;
  enlarged details show every returned group. Zero and missing values remain
  distinct, and query limits/overlapping user counts are disclosed. This does not
  affect time-series or Stat Bar charts, saved configuration or query identity.
  The module library offers country/device/browser/source donut presets. Donuts
  show up to six categories, or top five plus Other (chart 10) when there are more.
  Their shares and center sum cover **returned groups only**, not the range-wide
  total. User/session counts can overlap across groups; disclose this and possible
  row-limit truncation. Preserve every returned row in the enlarged details table.
  Left ring/right ranked list stack when the card is narrow. Focus or hover a row
  to highlight its segment; labels, exact values and percentages remain readable
  without interaction. Reuse queries and respect reduced motion and both themes.
  Country breakdowns also
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

Time-series density is automatic for Area, Line and Bar, not a saved view setting.
Read `docs/agents/time-series.md` before changing density. `DashboardDensity`
supplies the shared `TIME_SERIES_MAX_POINTS = 30` from `lib/charts/timeSeries.ts` for
all viewport widths, card sizes, Stat mini charts and editor previews. Resizing
only changes geometry/axis labels, never the query grain. Both Overview and Events
receive `maxPoints`; `internal/query/time_series.go` chooses a trusted, calendar-aligned
interval. With 30 points: 5m → 1m (5), 1h → 2m (30), 6h → 15m (24),
24h → 1h (24), 7d → 6h (28), 30d → 1d (30). Do not fabricate extra samples
to reach 30 or downsample/average the received values in the browser.
Non-aligned ranges can include one additional partial edge bucket. Existing clients
without this optional parameter retain their previous resolution; valid API budgets
are 24–240. Density participates in both query and Overview result-cache keys.
Backend aggregate states are merged at the requested grain, not averaged in the UI:
P75 uses t-digest, UV uses distinct states, rates use their numerators/denominators.
Adapters fill absent buckets with nulls so elapsed time and data gaps stay visible.
Charts show the returned interval and only 2–6 width-aware time labels; full local
dates remain available in the tooltip/table. Details and editor previews reuse the
page budget and data; widening a card never silently changes its statistical grain.

Line/Area renderers, including mini trends and enlarged details, share
`lib/charts/smoothCurve.ts` (monotone-X curves, round caps/joins). This changes
interpolation only, never buckets, aggregates or gaps. `isolatedDot.tsx` marks
only a valid sample with no valid neighbor, avoiding dots along continuous curves.

Query keys include user, project, source and effective query filters. Titles,
view types, selected response fields and dimensions of cards do not affect a
query key. Identical queries share one observer result, with six simultaneous
requests across the dashboard and configuration preview. All adapters take UV,
rates and P75 directly from backend aggregates. Missing rates and percentiles
remain null; sample and approximation notes remain available in the details dialog. Event Stat modules
do not fabricate previous-period comparisons.

In viewing mode cards show a title and primary value/chart. Stat cards place a
left-aligned comparison badge and "较上一周期" below the number, without a metric
description. Explanations stay in configuration/details. Reserve the top-right for the settings menu icon, without
a competing comparison badge. Rising traffic is positive; rising errors/failures or
Web Vitals is negative. Unavailable comparisons, rounded-zero changes and
insufficient samples stay neutral. A hover/focus settings menu is available without
entering edit mode; its icon remains visible on touch/narrow screens. The menu
includes configure, duplicate, preset widths, move, remove and **详细**.
`ModuleDetailsDialog.tsx` owns the scoped 1160px, viewport-bounded detail shell;
`ModuleDetails.tsx` composes the summary, chart/data-table Tabs and statistics rail.
On narrow screens the rail stacks below the chart. The Dialog reuses loaded data
for current/previous values, time range, freshness, statistical notes, trends and
exact-value tables. Its chart tab keeps all returned ranking groups, and its
table tab keeps exact values and missing buckets. Do not restore inline
"查看数据表" disclosures. All card details use the existing shadcn Dialog's
default motion, without source-card flip/expand or return animations. Radix owns
focus, dismissal and exit presence; no shared Dialog CSS or global behavior changes.
These components are being matured in the dashboard first, not rolled out to
other Console pages yet.
Configured table modules remain tables. Delayed-data dots stay visible in the
title, while full receive timestamps live in details. Opening a menu or details
never starts a draft, changes or saves the configuration. Applying a card change
starts an unsaved draft with Save/Cancel and drag handles. The page edit button
is icon-only (for adding/reordering modules); there is no page refresh button.

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

`statAppearance` is optional and allowed only on Stat widgets. Frontend validation
in `model.ts` and the Go allowlist must change together. Deploy/restart the API
alongside this UI change before saving appearances; no additional migration is
required. Existing records remain valid and are not rewritten automatically.

The `donut` breakdown view also requires the matching Go allowlist deployed or
the local API restarted before saving. No data migration is needed, and existing
dashboards are not modified automatically when new presets are registered.

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
