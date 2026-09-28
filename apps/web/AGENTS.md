# Prototype Instructions

Local development data generation uses a fixed bottom-right, icon-only “造数据” quick entry and a shadcn Dialog, not a status bar or settings navigation item. Keep its accessible label and hover title. Default to the current Project, Environment and analysis range; automatically use the Project's default public DSN. Report Ingest acceptance separately from queryable sample verification. Keep both UI and API development-only. See `docs/dev-data.md` for the code map and troubleshooting.

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

## Active product direction

- All Console Line/Area trends use `lib/charts/smoothCurve.ts`: smooth monotone-X
  interpolation with round caps/joins in page charts, mini charts, previews and
  enlarged details. Preserve measured values and null gaps; never average away
  real peaks for visual smoothing. Dashboard dots mark only isolated samples.

- Before implementing any Console time-series requirement, read `docs/agents/time-series.md`.
  Line, Area, time-based Bar, Stat, previews and details share an approximately
  30-point target, independent of width. Use `lib/charts/timeSeries.ts` and the
  shared backend policy; do not import helpers from another feature or add a
  page-specific interval table. Respect source resolution, preserve null gaps,
  disclose the returned interval and keep 2–6 readable axis labels. Resizing
  changes presentation only. The standard lists adopted and legacy consumers;
  do not claim unmodified historical pages are already migrated.

- Sessions keeps its high-density list full width and opens row previews in a
  right-side shadcn Drawer whose state is URL-backed. Full investigation lives
  at `/projects/:projectId/sessions/:sessionId`: lock the page to the Session's
  own time range, page the unified timeline by cursor, select events through
  the URL, and keep the type-specific inspector sticky on desktop. A browser
  Session ends after 30 minutes idle or 24 hours continuous activity; it is not
  a user's lifecycle. Do not expose a replay control until real privacy-filtered
  replay data and a player exist.
- Sessions, Events, API, Logs, and Issues use the shared focus-expanding filter search:
  `/` focuses it, selected conditions remain visible as removable tokens, and
  each page supplies only the fields its API supports. Do not duplicate these
  filters in a side rail or render a second search box. Logs keeps its full-width
  chart and list; express optional country/device/route/browser/release constraints
  through visible query terms, never hidden legacy sidebar URL parameters.
  In the Browser SDK, calling `logger.*` and configuring `captureConsole` are
  independent explicit opt-ins; never require `enableLogs`. Keep that option as
  a deprecated, ignored compatibility field until a future breaking release.
  Support explicit `user.id` query terms and show captured user/anonymous visitor
  IDs in log details, with same-user and same-visitor actions. Never infer a
  current user from a Session or fabricate profile fields not captured by the SDK.
  Issues keeps its high-frequency status as a Select immediately left of the
  shared search. Its search starts with Issue-specific title, error type, and Fingerprint fields,
  followed by user.id, release, browser, device, country, Route, and sorting. Issue-title
  search is server-side across the selected range, never scoped to the loaded page.
  Shared search field discovery matches technical keys and common aliases, so
  short input such as `u` can suggest a supported `user.id` field; never suggest
  a field that the current page query API cannot execute.
- Category Bar breakdowns use the `CategoryRanking` list: labels/metadata icons,
  exact values and shares are always visible above thin horizontal bars; no
  numeric axes or hover-only values. Rank by value and scale bars to the largest
  returned group. Compact cards show Top 10, enlarged details retain all returned
  groups, and shares use the full returned group sum, not Top 10 or a deduplicated
  overall total. Disclose overlap/query limits and support keyboard scrolling.
  Keep time-series Bar rendering unchanged.

- Breakdown modules also support `donut`: a left ring and right ranked list of
  labels, exact values and shares, stacked on narrow cards. Presets cover country,
  device, browser and source, using the existing event queries and persisted
  breakdown contract. Keep up to six slices; beyond six show the top five plus
  Other (chart 10). Shares and the center total describe returned groups only;
  disclose query limits and overlapping user/session counts. Preserve all groups
  in enlarged details and support keyboard focus as well as pointer highlighting.

- The world map view was removed at the user's request (2026-09-28). Do not
  reintroduce map charts or geo dependencies. A saved `map` view reads as ranked
  bars in the Console and is rejected by the backend on save; country data uses
  Bar, Table or donut like every other dimension.
- Project overviews are personal, per-user/per-project dashboards. Keep normal
  viewing uncluttered; reveal a settings menu on card hover/focus (always accessible
  on touch/narrow screens), without requiring edit mode first. Modules support
  adding, configuring, duplicating, removing, drag sorting and preset widths.
  The module library and configuration Sheet use a 1040px desktop width, capped
  at the viewport width on smaller screens; do not revert to a cramped 520px panel.
  Use the shared chart renderer, internal typed module registry and server-saved
  configuration; keep query logic in the console, not in the UI package.
- The feature is called **仪表盘** in the Console and public docs (never 数据大盘 or
  看板). Every Project has a built-in **默认仪表盘** defined in `builtIn.ts` and never
  stored; it is always first in the switcher, cannot be renamed or deleted, and its
  address is `/projects/:projectId/overview/default`. Editing it is allowed, but saving
  creates a new personal dashboard (「我的仪表盘」, numbered if taken) and opens it; the
  default itself never changes for anyone. The default must show every module kind at
  least once (all three stat styles; line with previous period, area, bar, stacked-bar
  and stacked-area trends; breakdown bar, table and donut; ranked table, metric table
  and the Top Issues list), with half-width modules in pairs; `builtIn.test.ts`
  enforces this.
- Each person keeps up to 20 personal dashboards per Project (the default does not
  count). The page title is the dashboard name and opens the switcher (create from
  blank/default layout/template or copy, rename, reorder, delete); list actions are
  disabled while a draft is unsaved. Personal dashboards use
  `/projects/:projectId/overview/:dashboardId`; the bare overview address opens the
  last-used one on this device (else the first personal one, else the default) and
  never redirects. Duplicate on the server so unknown modules survive.
- The module library is organized by data domain: 推荐 / 流量与会话 / 性能 / API /
  错误 / 业务指标 / 用户行为, with blank module types under 自定义. Each concrete module
  appears once, in one domain (`library.ts`); "推荐" filters flagged entries and search
  spans every domain. Dimensions such as country, device or browser are choices inside a
  module, never library cards of their own. New modules read the metric catalog
  (behavior events included); the classic overview and events sources stay only for
  modules that already use them.
- Modules can read the backend metric catalog (`version: 2`, `source: "catalog"`).
  Offer metrics grouped by family, disable incompatible picks and views with the
  validator's own reason, and strip settings a change made invalid rather than
  failing the save. Keep one unit per chart and never mix sample-rate-weighted and
  unweighted counts; only metrics that add up get "Other", shares, donuts or stacks.
  The previous period is a dashed `--ds-chart-comparison` line behind the current
  series. Ranked and metric tables open in 详细 with every returned row; drill-down
  links exist only where the destination page reads the value from its URL.
  Update `catalogRules.ts` and `internal/catalog` together; the shared case matrix
  must pass on both sides. Behavior events are a catalog source too: split
  `behavior.events` by 事件名称 and pin the events to compare (`groups`, drawn in the
  picked order, at most nine lines) to put payment started/succeeded/failed on one
  chart. Pinned groups replace the top-N limit and never produce "Other".
- Dashboard card menus label the investigation action **详细**, not 放大查看.
  `ModuleDetailsDialog` is the dashboard-scoped detail shell: a wide chart/data-table
  workspace with a statistics/context rail, stacked on narrow screens. Stat details
  lead with current and previous values plus the semantic comparison. Keep exact
  tables in a separate shadcn Tab, preserving explicitly configured Table views.
  All dashboard details use the existing shadcn Dialog's default motion; do not
  add source-card flip/expand or return animations.
  Respect reduced motion, keep the close action visible and return keyboard focus
  to the card menu. Reuse loaded buckets without requests, saves or denser reaggregation.
  Mature the card components here before migrating other Console pages; do not
  roll out this layout site-wide without a separate request.
- Overview stat cards show the title, primary value, then a left-aligned
  period-change badge with "较上一周期" beneath the number, without a metric
  description on the card. Keep explanations in configuration/details only.
  Reserve the top-right for the settings menu icon; do not put
  comparisons beside it. Use positive/negative semantic colors based on the metric:
  rising PV/UV is positive, while rising errors, failures and vital timings is
  negative. Missing comparisons, rounded zero and insufficient samples stay neutral.
  Stat configuration includes optional `statAppearance`: plain (legacy default),
  line-right or bar-right. Retired line-bottom/area-bottom values normalize to
  line-right when read; do not offer or render bottom variants. Keep range-wide aggregates unchanged;
  mini charts reuse the existing Overview/Events time buckets, preserve null gaps
  and show an empty message rather than synthetic data. Use smooth monotone
  curves for mini Line charts without changing samples or connecting gaps. Right-side
  Bars keep the same buckets, with narrow rounded columns and visible gaps. Mini charts
  remain display-only inside cards: no tooltip, active dot, pointer or keyboard
  interaction. Both trend appearances sit to the right of the number/comparison.
  Keep full-chart interaction and accessible tables inside enlarge/details.
  Appearance changes must
  not create extra data queries. Respect reduced motion and both themes. Update
  the frontend schema and Go dashboard allowlist together for saved options.
  Put enlarge/details inside that menu, not in a separate card button. Outside
  edit mode the page header shows a gear that reveals **编辑** and **添加模块** on hover
  or keyboard focus (always visible on touch and narrow screens); adding from there
  starts a draft directly. There is no adjacent refresh action. Card changes create
  an unsaved draft with Save/Cancel; opening menus/details alone must not create one.
  Put sampling/approximation notes, receive timestamps, previous values and chart
  tables in an accessible Dialog using the same loaded data, never an inline
  "查看数据表" disclosure. Keep delayed-data dots visible and preserve explicitly
  configured Table views and edit-mode controls. Opening details must not save
  configuration or request the same module again.
- Authentication pages use a simple, centered single column: shared brand mark,
  concise copy, and a narrow form on a plain theme-aware background. Avoid split
  screens, promotional side panels, and decorative glows. Login actions use
  black/white contrast tokens and retain the compact theme toggle.
- The accepted layout target is `../../output/imagegen/openrum-dashboard-stripe.png`.
- Use the Citrus-adapted shadcn theme: neutral white/graphite surfaces, lime primary, teal secondary, comfortable commercial-reporting density, subtle radii and shadows. Keep red reserved for destructive and error semantics.
- In light mode, keep canvas, cards, tables, text, and primary page actions neutral;
  main actions stay black with white text. Use lemon green only for compact badges,
  icons, focus rings, progress, and selected/effective form states. Selected options
  use the shared selection tokens and a pale lime surface with a stronger lime
  border; ordinary hover remains neutral. The Rate Limits page is the settings-form
  reference. See `docs/design.md`, "Light-mode Citrus accent hierarchy".
- The overview must treat country, device, browser, and custom dimensions/metrics as first-class analysis surfaces.
- Use the typed Go query APIs for implemented product areas; keep deterministic frontend fixtures for unit tests and explicit demo states only.
- Preserve the planned React + TypeScript + Vite stack and the `apps/web` project location.
- Readability outranks maximum density. Product body, default controls, and table
  body text start at 14px; table headings and metadata start at 12px. Default
  controls are 40px high and table rows are at least 44px. Compact variants are
  opt-in for secondary inline actions, toolbars, and icon rails; never use them
  for a page's primary form or main action without a documented reason.
- Use shadcn/ui (Radix Nova + Tailwind CSS v4) for reusable UI primitives. Keep
  component source local, use semantic tokens, and support light, dark, and
  system appearance without component-level theme colors.
- Object storage settings are provider-first and page-managed by default. Let
  administrators choose Alibaba OSS, Amazon S3, Cloudflare R2, MinIO, or another
  S3-compatible service, then show only the relevant connection and credential
  fields. Test write/read/delete before saving encrypted credentials; keep
  RAM/IAM roles and deployment-managed Secrets as the advanced production path.
- Every authenticated Console route uses the shared Console page components.
  Choose only `fluid`, `wide`, or `narrow`; render the desktop `ContextRail`
  only when the page supplies contextual navigation, and compose header,
  optional description, tabs, filter bar, and content through their named
  slots. A page owns its filter controls, while the filter bar owns placement
  and responsive behavior. See ADR 0004.
- The main sidebar exposes one **项目设置** entry. 接入、发布、用量, data
  governance, quota, and development data generation live
  in that page's contextual navigation. Keep the account popover concise:
  unchanged user identity, one Account entry, one horizontal three-icon
  appearance switcher (system/light/dark), then sign out. Personal,
  Organization, notification, and Instance destinations live in the Account
  settings rail; Instance settings are visible only to Instance Administrators.
- Entering any settings route replaces the primary sidebar navigation with the
  scoped settings navigation using a short horizontal slide. Keep the brand and
  account areas stable, provide an explicit back row at the top, and never repeat
  the same settings rail inside the page content.
- On desktop, sidebar expand/collapse lives at the far-left edge of the sticky
  content status bar. The sidebar brand row uses that former action slot for a
  project-switch indicator; when collapsed, show only the mark and hide the
  indicator.
- Do not render a separate project-switcher card in the sidebar. The brand link
  remains the route back to the project list and reveals the project switcher
  on hover or keyboard focus. Project routes show project name and environment
  beside the slightly larger mark; non-project routes show the OpenRUM name.
- A Project represents one monitored product and owns a bounded list of
  Environments. The project hover panel selects from the server-provided list;
  never hard-code environment names in Console filters. Project rows show the
  project Slug rather than presenting the default Environment as project metadata.
- The right workspace always has one sticky app status bar. Global utilities
  such as appearance, future language, and notifications live on its right
  edge. Do not render explanatory copy on the left side of this bar. Data-analysis
  routes place time on the left side of the status bar, immediately after the
  sidebar toggle. The control pairs a relative range on the left with the current
  absolute date range on the right. Environment selection lives in the project
  switcher's hover panel and updates the same shared analysis context;
  offer relative ranges from 5 minutes through 30 days plus an absolute range,
  preserve both values across navigation, and keep page-specific dimensions in
  the page. Keep analysis overview, funnels, paths, and retention as separate
  routes grouped by page-level tabs; refresh remains a page-header action.
- Treat ClickHouse storage pressure as a global Console state. At 90% used,
  Browser SDK sampling is capped and every Console route shows a warning Banner;
  at 95% used, Ingest deliberately drops new envelopes without retry and the
  Banner becomes critical. Keep the hard stop latched until usage falls below
  90%, then remove the Banner after the successful recovery observation. When
  pressure is active, Instance Settings offers a separate guided recovery flow:
  recommend Project/month partitions whose calendar month ended at least 24 hours earlier,
  show predicted disk usage, require explicit phrase and Owner password
  confirmation, and track one global background job. Do not expose SQL or reuse
  ordinary retention mutations for this path.
- Omit navigation breadcrumbs from Console page headers. The sidebar selection
  and page title carry location; keep event breadcrumbs only where they represent
  observed session or error context rather than navigation.
- The color reference is the user's Citrus dashboard9 screenshot (2026-09-12).
  All logos and favicons stay lemon green (`--ds-logo`) in both modes. Headings,
  KPI values, labels and navigation use neutral text; selected navigation uses
  the neutral sidebar accent. Chart strokes and fills share chart-series tokens:
  chart 1 lemon green, chart 2 teal, prior periods pale yellow plus dashes.
  Axes and annotations use muted text; grids and cursors use borders. Reserve
  success/warning/danger for actual statuses and thresholds. Link ink (`--ds-brand`)
  uses neutral text in both modes; underline prose links. Never use this token
  for logos or chart outlines. See `docs/design.md`,
  "Chart color contract", and the live `/design` workbench.
- Keep primary header brand lockups on the shared 28px mark / 18px wordmark / 9px
  gap ratio. Use the tighter favicon crop so the mark fills small browser icon slots;
  do not reintroduce per-surface header logo sizing.
- Charts animate by default. Recharts runs its transitions in JavaScript, so the
  global `prefers-reduced-motion` stylesheet cannot reach them; pass
  `isAnimationActive={useChartMotion()}` rather than hard-coding `false`.
- Keep the performance workspace full-width. The user explicitly wants LCP,
  INP, and CLS in one combined date-based chart and the performance score kept.
  Its page header contains only the title, without a subtitle or refresh button;
  retain retry actions within error states.
  Use one SVG segmented score ring with a centered total and metric names directly
  outside their sectors, matching the user's ring reference (2026-09-13).
  Size sectors by default score weight (LCP/INP 30%, CLS/FCP 15%, TTFB 10%),
  using the same weight definition as the total. Center SVG score text with
  `text-anchor="middle"` and `dominant-baseline="central"`, not the x-height-based
  `middle` baseline. Use neutral unearned-score tracks,
  and retain the Citrus series colors; use INP, not the reference's legacy FID.
  Do not add concentric rings or a separate legend below the ring.
  Place it beside one real-value trend chart, with five compact
  metric cards (LCP, INP, CLS, FCP, TTFB) below. Do not normalize to threshold
  percentages or plot score contributions: timing metrics share a millisecond
  left axis and CLS uses a clearly labeled unitless right axis; cross-axis height
  is not comparable. Put P50/P75/P95 in one compact dropdown at the chart's top
  right. Keep small, muted metric visibility toggles inside the card content
  below the plot, without a separate gray footer, divider or outlined pills.
  Preserve visible off and keyboard-focus states. Remove the page-wide metric toolbar; put
  route sorting in the route table and detail controls in the detail. Keep the OpenRUM 0–100 score,
  use the existing scoring curve on actual overall P75s with Sentry's default
  metric weights: LCP 30%, INP 30%, CLS 15%, FCP 15%, TTFB 10%. This adopts only
  the weights, not Sentry's log-normal scoring model or desktop thresholds.
  Missing metrics are excluded rather than filled with zero or a perfect score;
  renormalize available weights for the reference total and retain missing
  metrics' default-size neutral sectors. Label incomplete and low-sample scores
  as reference. It is separate
  from CWV status and unaffected by chart visibility or P50/P75/P95
  selection. Compute overall values from matching samples, never route averages.
  Use the reusable, collapsible right-side `AnalysisFilterSidebar` for country,
  device, route, browser, and release where the API supports them. Pages own the
  dimensions; apply drafts together, keep applied filters in URLs, retain them
  when collapsed, and use a Sheet on narrow screens. Time/environment remain
  in the shared app context. Performance and Issues are the first consumers.
- Treat each project card as an operational health summary. Lead with the last
  24 hours of PV, UV, error events, a real PV trend, and reporting freshness;
  keep sampling, retention, role, and other configuration details secondary.
- Project settings exposes **常规、接入指引、数据管理、用量统计**. Group sampling,
  rate limits, inbound filters, URL normalization and privacy scrubbing inside
  **数据管理** using `ProjectDataSettingsShell` and the route-backed sections in
  `projectDataSettings.ts`. Use shadcn Tabs with the **line** variant (underline,
  no filled selection pills), retaining the section URLs and keyboard navigation.
  Do not scatter these controls across sidebar subgroups
  or hide sampling inside the usage report. Each section saves independently;
  settings apply across all Project environments. Preserve existing rule/limit
  URLs and keep 数据管理 selected for every section.
- Sampling lives at `/settings/project/:projectId/sampling`; load Project configuration
  independently from its seven-day, all-event usage estimate. An unavailable,
  empty or capped estimate must not prevent configuring sampling. Distinguish
  SDK sampling from request-rate overload protection.
- Keep project-level reports under **项目设置 → 用量统计**, with
  `/settings/project/:projectId/usage` as the canonical address. Preserve query
  filters when redirecting legacy `/projects/:projectId/usage` links. Keep
  cross-project ingestion usage in the organization-level `/usage` page
  as the only organization-level sidebar item. The brand/Logo remains the sole
  entry to the Project list; never duplicate Projects in navigation. Project
  usage links preserve the selected range and event type. Statistics cover all project environments;
  distinguish transfer bytes from stored bytes and usage share from quota usage.
  Failed project queries must remain visibly unavailable, not zero; suppress
  organization shares when coverage is incomplete and truncated trend charts.
- Browser metadata uses the full-color `devicon:chrome` and `devicon:safari`
  artwork, bundled locally rather than loaded from a CDN. Keep browser names in
  accessible labels and hover tooltips; the dense Sessions table shows only the
  icon.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.
