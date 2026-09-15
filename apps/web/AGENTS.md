# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

## Active product direction

- Sessions keeps its high-density list full width and opens row previews in a
  right-side shadcn Drawer whose state is URL-backed. Full investigation lives
  at `/projects/:projectId/sessions/:sessionId`: lock the page to the Session's
  own time range, page the unified timeline by cursor, select events through
  the URL, and keep the type-specific inspector sticky on desktop. A browser
  Session ends after 30 minutes idle or 24 hours continuous activity; it is not
  a user's lifecycle. Do not expose a replay control until real privacy-filtered
  replay data and a player exist.
- Logs uses a full-width chart and list with its own query search and severity
  selector. Do not render the shared dimension sidebar, its toolbar, or active
  chips on this page. Keep global time/environment controls; express optional
  country/device/route/browser/release constraints through visible query terms,
  never hidden legacy sidebar URL parameters.
  In the Browser SDK, calling `logger.*` and configuring `captureConsole` are
  independent explicit opt-ins; never require `enableLogs`. Keep that option as
  a deprecated, ignored compatibility field until a future breaking release.
  Support explicit `user.id` query terms and show captured user/anonymous visitor
  IDs in log details, with same-user and same-visitor actions. Never infer a
  current user from a Session or fabricate profile fields not captured by the SDK.
- Country breakdown modules support a saved `map` view alongside Bar/Table.
  Render all returned country groups with the lazy bundled SVG map, semantic
  lime intensity and localized ISO labels. Never treat unreturned data as zero
  or silently drop unknown/unmapped countries; retain them in the details table.
  Keep map selection country-only in the editor and frontend/backend validation;
  changing dimension falls back to Bar. Country queries allow 250 groups while
  other dimension budgets remain 100. Reuse loaded data for map/table details.
- Project overviews are personal, per-user/per-project dashboards. Keep normal
  viewing uncluttered; reveal module controls only in edit mode. Modules support
  adding, configuring, duplicating, removing, drag sorting and preset widths.
  Use the shared chart renderer, internal typed module registry and server-saved
  configuration; keep query logic in the console, not in the UI package.
- Overview stat cards show the title, primary value, then a left-aligned
  period-change badge with "较上一周期" beneath the number, followed by one short
  metric description. Reserve the top-right for the details icon; do not put
  comparisons beside it. Use positive/negative semantic colors based on the metric:
  rising PV/UV is positive, while rising errors, failures and vital timings is
  negative. Missing comparisons, rounded zero and insufficient samples stay neutral.
  Reveal a details icon on hover/focus and keep it visible on touch/narrow screens.
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
- Browser metadata uses the full-color `devicon:chrome` and `devicon:safari`
  artwork, bundled locally rather than loaded from a CDN. Keep browser names in
  accessible labels and hover tooltips; the dense Sessions table shows only the
  icon.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.
