# Project dashboards (仪表盘)

Every project has a built-in **默认仪表盘** (`builtIn.ts`), defined in code and never
stored. It lives at `/projects/:projectId/overview/default`, is always first in the
switcher and cannot be renamed or deleted. Editing it is allowed; saving creates a new
personal dashboard (「我的仪表盘」, numbered when taken) and navigates to it, so the
default never changes for anyone.

Personal dashboards are keyed by the authenticated user and project. Viewers can edit
their own. Each person may keep up to 20 per project (the default does not count); the
page title switches between them. The ordinary overview route opens the dashboard last
used on this device, else the first personal one, else the default. Personal dashboards
live at `/projects/:projectId/overview/:dashboardId`.

## Catalog modules (version 2)

Modules can read the metric catalog owned by the backend (`internal/catalog`)
instead of the classic Overview/Events responses. They are stored as `version: 2`
widgets with `data.source: "catalog"`, so an older deployment keeps them verbatim.

- `data.metrics` names catalog ids such as `traffic.sessions` or
  `api.durationP95`; `dimension`, `measurement`, `filters`, `compare`, `topN`,
  `sort`, `sparkline` and `groups` complete the question. `groups` pins a split to
  chosen values in order (for example three event names as three lines) and replaces
  `topN`; it never yields "Other". Types are `stat`, `timeseries`,
  `breakdown`, `ranked-table` and `metric-table`; timeseries also offers
  `stacked-area` and `stacked-bar`.
- `queries.ts` (`catalogQueryParams`) maps a module to one request to
  `GET /api/v1/projects/:id/metrics/query`. A stat always asks for its comparison
  and a ranked table for its change and sparklines, so appearance changes never
  issue new queries. Page-level release/route links override module filters only
  where the metric's source supports them.
- `catalogRules.ts` mirrors `catalog.Validate`. The editor uses it to disable
  invalid views and metric picks with a reason, and to strip settings a change
  made invalid. `catalogRules.test.ts` runs the backend's shared case matrix
  (`internal/metadata/testdata/dashboard_widget_cases.json`) against the golden
  catalog (`internal/catalog/testdata/catalog.golden.json`); a disagreement fails.
- `adaptCatalog.ts` keys series synthetically (`m0`, `g0`, `g_other`,
  `m0__prev`) because Recharts reads dots in a dataKey as a path. Ratios are shown
  as percentages, changes in percentage points. Only metrics that add up get an
  "Other" row, shares or a donut (`distribution.shareable`).
- Colours come from `lib/charts/palette.ts` by rank; the previous period is a
  dashed line in `--ds-chart-comparison`.
- `library.ts` is the module library, organized by data domain (推荐, 流量与会话,
  性能, API, 错误, 业务指标, 用户行为, 自定义). Each entry lives in exactly one domain
  and declares the catalog metrics it reads; entries whose metrics the catalog lacks
  are hidden. `templates.ts` composes dashboards from library entries, so a module is
  defined once. `catalogQuery.test.ts` checks every entry validates, declares exactly
  what it reads, and that names are unique.
- New modules read the metric catalog, including the `behavior` source (event count,
  users and Sessions, split by event name, country, device, browser, source or a
  property). The classic overview and events sources are offered only to modules that
  already use them. The built-in default is catalog-only apart from the Top Issues list.

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
  or `area-right`. Configure it through the card's hover menu → Configure → Card
  appearance, then Apply and Save the dashboard. The right layout pairs the number
  with a small smooth area (line over a fading fill). Retired `line-right`,
  `bar-right`, `line-bottom` and `area-bottom` records normalize to `area-right`
  during validation/read, without rewriting storage automatically. The Go
  allowlist retains those old values for existing records and rolling upgrades,
  but the editor only offers the two current appearances.
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
  The world map view was removed; a saved `map` view reads as Bar and the backend
  rejects it on save. Country queries keep their 250-group budget so a ranking can
  list every country; other dimensions retain 100.
- `top-issues`: the Issues with the most events, with current filters in drill-down links.
  Slowest APIs are a catalog metric table (`slowApiModule()` in `model.ts`): P95, request
  volume and failure rate by API, where groups with too few samples rank last. The classic
  `slow-apis` list and the overview response's `slowApis` field were removed.

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

In viewing mode cards show a title and primary value/chart. Stat cards show the number
alone and pin the previous-period badge to the card's top-right; its hover/focus tooltip
reads "较上一周期 +x%" and the previous period's value (insufficient samples read "样本不足").
Explanations stay in configuration/details. Rising traffic is positive; rising
errors/failures or Web Vitals is negative. Unavailable comparisons, rounded-zero changes
and insufficient samples stay neutral. Card actions float at the bottom-right in a frosted
capsule — an expand button that opens **详细** and the settings menu — shown on hover or
keyboard focus without entering edit mode, and always visible on touch screens. The menu
includes configure, duplicate, preset widths, move and remove. While editing, the drag
handle sits in the header and the corner badge is hidden.
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
custom colors or shared/public dashboards.

## Persistence and rollout

Apply PostgreSQL migration `0023_user_dashboards` before starting the new API.
It copies each existing layout into `user_dashboards` as the user's first
dashboard ("我的仪表盘"), keeping its revision. The old `user_project_dashboards`
table is kept for one release so a rollback loses nothing; rolling back writes
each user's first dashboard back and drops the rest. No ClickHouse or SDK
migration is required: the metric catalog reads existing aggregates.

Named dashboards: `GET/POST /api/v1/projects/:id/dashboards`,
`GET/PATCH/DELETE .../dashboards/:dashboardId`, `PUT .../dashboards/:dashboardId/config`
(`{ config, revision }`, 409 `CONFIG_VERSION_CONFLICT`), `POST .../duplicate`
(copied on the server so unknown modules survive) and `PUT .../dashboards/order`.
Renaming does not advance a dashboard's revision. The old single-dashboard pair
below still works, maps to the first dashboard and answers with `Deprecation`
headers; it will be removed with the old table.

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

Catalog modules and named dashboards:

- Open the title menu: create a dashboard from each template, rename it, reorder
  the list and delete one. The address follows the selected dashboard and keeps
  the time range and Environment; the bare overview address reopens the last one.
- With unsaved changes, switching dashboards asks before leaving, and list
  actions are disabled.
- Add modules from the 推荐 group: API outcome composition (stacked), latency
  percentiles, sessions with the previous period, Top pages, error rate by
  browser, country overview (metric table), new Issues, revenue.
- In the metric picker, pick a count then try a rate: it is disabled with a
  reason. Split a trend by device and stack it; try stacking error rate by
  browser: the stacked view is disabled.
- Ranked and metric tables: sort columns, open 详细 to see every row, follow a
  release/route drill-down link.

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

## Sizes and tabbed cards

Module sizes are `compact` (stat cards), `third`, `half` and `full`; on screens 1280px and
wider they span 3, 4, 6 and 12 of 12 columns. The dashboard is fluid up to 1920px and then
centred, and from 1680px gaps and chart heights grow a little instead of stretching cards.

A tabbed card is two or three adjacent chart or table modules sharing one `groupId`. The
saved config stays flat (`groups.ts` turns it into cards), every member keeps its own
validation and query, and only the visible tab is queried. Members share the card's size.
The card menu merges a card into another (`合并到…`), takes the current tab out
(`移出为独立卡片`) or removes it; a card left with one module dissolves. Stat cards never
join. The Go allowlist (`validateDashboardGroups`) enforces the same rules on save.
