# OpenRUM overview design QA

## Evidence

- Source visual truth: `output/imagegen/openrum-dashboard-stripe.png`
- Latest desktop implementation: `output/qa/openrum-readable-desktop.jpg`
- Latest lower-region implementation: `output/qa/openrum-readable-lower.jpg`
- shadcn/ui light theme: `output/qa/openrum-shadcn-light.jpg`
- shadcn/ui dark theme: `output/qa/openrum-shadcn-dark.jpg`
- Dark-theme table evidence: `output/qa/openrum-shadcn-dark-lower.jpg`
- Source/light comparison: `output/qa/openrum-shadcn-source-comparison.jpg`
- Light/dark comparison: `output/qa/openrum-theme-comparison.jpg`
- Responsive implementation evidence: `output/qa/openrum-readable-mobile.jpg`
- Full-view comparison: `output/qa/openrum-readable-comparison.jpg`
- Focused lower-region comparison: `output/qa/openrum-readable-lower-comparison.jpg`
- Local implementation: `http://localhost:4173/`

## Viewport and normalization

- Source: 1440 × 1024 px, desktop app frame, assumed density 1.
- Desktop browser: 1280 × 720 CSS px, device pixel ratio 2. The in-app browser
  screenshot is normalized to 1280 × 720 output pixels.
- Comparison normalization: source scaled proportionally to 1280 × 910, then
  compared in two 1280 × 720 crops against the top and lower browser states.
- Native 1440 × 1024 browser resizing is not exposed by the in-app browser. The
  normalized 1280 desktop comparison therefore serves as the fidelity target;
  layout behavior above 1300px remains the uncollapsed six-cell/four-breakdown
  design defined by CSS.
- Mobile verification: real 390px-wide iframe viewport at 390 × 650 CSS px,
  device pixel ratio 2. Document metrics were `clientWidth=390`,
  `scrollWidth=390`, and `scrollHeight=2244`; no horizontal page overflow.
- State: production project, v2.18.0, past 24 hours, country analysis active.

## Required fidelity surfaces

- Fonts and typography: Inter/system sans and JetBrains Mono reproduce the
  commercial reporting hierarchy. The readability design system now uses a
  24px page title, 16px section titles, 14px body, 12px table/control text,
  11px metadata, and 30px KPI numerals. Table truncation and tabular numerals
  were visually checked at the final sizes.
- Spacing and layout rhythm: 188px sidebar, six-cell KPI strip, 62/38 trend row,
  analytics/query split, and lower table split align with the source. At 1280px,
  the browser quick column is intentionally moved behind its tab to prevent
  wrapped labels; it remains visible in the accepted 1440px layout.
- Colors and tokens: true white page, warm-gray rules, near-black navy text,
  violet-blue accent, and red/amber/green semantic states match the source.
- Color modes: light, dark, and system modes share one semantic token layer.
  Dark mode uses blue-black surfaces, readable neutral text, and the same violet
  and status hierarchy. Chart axes/grid, world map, tables, dropdown, detail
  drawer, and interactive states were checked in dark mode.
- Image/asset fidelity: the geographic distribution uses a real world topology
  rendered through the geo library, with China highlighted. Icons come from one
  consistent Phosphor family; no screenshot or placeholder is shipped as UI.
- Copy and content: breadcrumb, navigation, KPI labels/values, release/time
  filters, issue rows, custom telemetry fields, and API data match the accepted
  concept. The visible above-the-fold copy diff has no unapproved additions.

## Full-view and focused evidence

- Full-view comparison confirms the same shell, header, KPI proportions, chart
  and alert anatomy, and analytics/query module order.
- Focused lower-region comparison confirms the country map, ranked data,
  custom-query builder, readable issue table, and API table.
- Separate focused crops were necessary because the app is a dense dashboard and
  table text is not readable enough in one overview comparison.

## Comparison history

### Iteration 1

- [P2] At 1280px the device/browser ranking headers wrapped in narrow columns.
  Fix: added a responsive breakpoint that keeps country and device summaries in
  the default view and preserves browser data behind the visible browser tab.
  Post-fix evidence: `output/qa/openrum-source-render-comparison.jpg`.
- [P2] Recharts emitted initial-size warnings for the main chart and table
  sparklines. Fix: gave the main responsive chart an initial dimension and made
  table sparklines deterministic 45 × 20 charts. Post-fix console contains no
  warnings or errors.
- [P2] The first implementation exposed two pieces of copy not present in the
  accepted source (`18 秒前更新` beside the title and `对比昨日` in the chart
  header). Fix: removed both visible labels; freshness remains accessible on the
  refresh control and compare remains in the approved analytics toolbar.

### Final pass

- No actionable P0, P1, or P2 findings remain.
- User-approved typography deviation: the accepted concept used exceptionally
  small reporting text. The implementation deliberately enlarges type,
  controls, row heights, and panel heights through shared tokens while retaining
  the Stripe-style hierarchy, information architecture, and restrained density.
- [P2] The issue-table action label wrapped vertically after the table font was
  enlarged. Fix: widened the action column to 9% and prevented button wrapping.
- P3/intentional deviation: chart curves are generated from interactive mock
  points rather than copied pixels, so exact curve curvature differs while the
  scale, colors, release marker, tooltip, and error spike anatomy are preserved.

### shadcn/ui and theme pass

- Initialized shadcn/ui with the Radix Nova preset and Tailwind CSS v4.
- Reviewed the generated Button and Dropdown Menu source; removed component-level
  dark overrides and manual overlay z-index so both consume semantic variables.
- Added a light/dark/system menu using the checked-in shadcn primitives.
- At 1280px, stacked the two dense data tables to preserve the 12px readability
  baseline instead of compressing nine issue columns.
- Direct 390px dark-mode document metrics: `clientWidth=390`,
  `scrollWidth=390`, `scrollHeight=2244`; no page-level horizontal overflow.

## Interaction and console verification

- Tested release and time-range selection.
- Tested country/browser/custom-dimension tabs and comparison state.
- Tested custom-query creation success notice.
- Tested issue detail drawer open/close.
- Tested light/dark/system menu options and verified the selected mode survives
  page navigation/reload through local persistence.
- Tested sidebar navigation and return to the dashboard.
- Direct app console: no warnings or errors.

## Implementation checklist

- [x] Source and latest render opened together and compared.
- [x] Desktop and 390px responsive states checked in the in-app browser.
- [x] Core interactions update local UI state.
- [x] TypeScript, production build, and Sites worker tests pass.
- [x] All normal dashboard text respects the 11px minimum token; tables use 12px.
- [x] shadcn project context resolves Vite, Radix Nova, Tailwind v4, aliases, and
  installed Button/Dropdown Menu components.
- [x] Temporary mobile QA wrapper removed.

final result: passed
