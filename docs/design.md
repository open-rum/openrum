# OpenRUM frontend design system

## Source of truth

The accepted overview concept is `output/imagegen/openrum-dashboard-stripe.png` at
1440 × 1024. It defines the initial frontend shell and overview information
architecture, not the current palette. The user-supplied
`OpenRUM_Landing_Page_Spec_v1.docx` adds the current brand mark and a separate
landing-page reference concept. Its earlier Acid Green direction is no longer
an active product theme.

The current color reference is the user's Citrus screenshot of
[shadcnblocks dashboard9](https://www.shadcnblocks.com/block/dashboard9)
(2026-09-12). Match its neutral text and surfaces, lemon-green logo and chart
series, teal secondary series, and pale-yellow period comparison. The screenshot
takes precedence over the upstream preview's default, uncustomized theme.

## Visual workbench

`apps/site/src/pages/design/index.astro` publishes `/design/`: brand assets,
the canonical Citrus theme, semantic colors, typography, spacing, radii, material, and
Area / Bar / Line chart examples. It is a site route, not a package or a
component-library application. The page reads actual CSS custom properties;
it does not maintain a second table of color values.

The typography section includes a font-selection preview: Geist (current),
Inter, IBM Plex Sans and Manrope for Latin text, paired independently with
system Chinese fonts or Noto Sans SC. Selections affect only the workbench and
persist in its `font` / `cjk` URL parameters; they do not change product defaults.
Compare editable text, KPI numbers, 14px tables, and chart labels. Reset restores
Geist and system Chinese. Fonts are self-hosted via Fontsource; Noto Sans SC's
stylesheet loads only when selected, with Unicode subsets fetched as needed.

Shared foundations remain in `packages/design-tokens`:

- `tokens.css`: canonical Citrus roles and design scales.
- `catalog.ts`: Citrus display metadata and the semantic-token catalogue.
- `brand.ts`: the two paths of the document's rounded, split-ring SVG mark.

The site, documentation, and console apply `data-palette="citrus"` to the
root. Citrus is the only supported palette; legacy `openrum-palette` storage
and `?palette=` values are ignored and cleaned up during bootstrap. Preview
links carry only `?theme=dark|light`. Theme storage remains per origin, so site
and console ports can still have independent light/dark preferences.

The brand mark is reconstructed from the document's raster reference. It uses
shared SVG geometry in Astro and React, with a monochrome wordmark. `/design/`
provides lemon-green SVG downloads and light/dark surface previews. Every mark
uses `--ds-logo` (`#b8e954`) in both modes; wordmarks use neutral text. The favicon is a static copy of
that geometry; update both apps' favicons when changing the shared mark.

## Visual language

- Citrus is the only product theme. Do not add page-level palette switches or
  alternate palette overrides.
- Headings, KPI values and table content use `--ds-text`; field labels and
  legends use `--ds-text-secondary`; descriptions and axes use `--ds-text-muted`.
  Legend swatches carry series color; their labels remain neutral.
- Navigation selection uses `--ds-sidebar-accent` and its neutral foreground.
  Ordinary controls use neutral borders and surfaces. Primary fills pair with
  `--ds-primary-foreground`; contrast actions retain black/white tokens.
- Link ink (`--ds-brand`) follows neutral `--ds-text` in both modes, per the
  user's preference. Distinguish prose links with underlines, not olive or lime
  text. Logos and chart series retain their separate color tokens.
- Main homepage actions remain black and white. Landing concept 01 follows the
  document's green action in dark mode and a dark action in light mode.
- Error, warning, and success remain independently recognizable and pair
  color with labels, shapes, or icons.
- Radius: 5 / 7 / 9px. Shadows are limited to controls and elevated surfaces.
- Typography: Geist Variable with system Chinese fallback; the Space Grotesk
  wordmark uses SVG outlines. Marketing display sizes are 56 / 38px and
  section headings 40 / 30px. Product UI uses a comfortable 12–14px scale.

## Landing concepts

- `/` is the existing centered headline / Light Rays homepage.
- `/design/landing/01/` is the static document reference: split Hero, product
  mockups, trust strip, features, errors, analytics, performance, platforms,
  self-hosting, and open-source CTA. Mockups contain clearly labelled sample
  data. Planned SDKs remain marked Roadmap.
- `/design/landing/` compares independent pages in scalable desktop, tablet,
  and mobile viewports. Both previews receive the same selected theme. The
  scheme's Analytics and Self-hosting sections intentionally use
  a local light scope, as in the document.

Add future schemes as separate routes and register them in
`apps/site/src/lib/landing-concepts.ts`; keep earlier concepts for comparison.
The first concept uses HTML and SVG, with no WebGL or continuous animation.
Appearance controls sit outside the concept and hide in embedded previews.

## Component foundation

OpenRUM uses shadcn/ui conventions everywhere custom product UI is built. The
shared baseline is the Radix Nova preset, Radix primitives, Tailwind CSS v4,
CSS variables, and Lucide icons. `apps/web/components.json` is the currently
verified configuration; `apps/site` must use the same style, base, icon library,
radius, and semantic-token contract.

Two workspace packages prevent the console and public site from drifting:

- `packages/design-tokens` is the only source for brand, color-mode,
  typography, spacing, radius, shadow, motion, chart, and status variables.
- `packages/ui` owns shared shadcn primitive source and variants. Console-only
  data compositions stay in `apps/web`; public-site and documentation
  compositions stay in `apps/site`.

Starlight may provide documentation routing, search, table of contents, and
content structure, but its visible theme must map to the shared semantic tokens.
Custom actions, forms, overlays, feedback, navigation, and data display use the
shared shadcn primitives instead of introducing a second component vocabulary.

### shadcn implementation contract

- Search the configured shadcn registry and use an existing component before
  creating custom styled markup; compose components instead of forking them per
  app.
- Use semantic variables and variants such as `background`, `foreground`,
  `primary`, `muted`, `accent`, `destructive`, and chart/status tokens. Do not
  hard-code product colors or add component-level `dark:` color overrides.
- Use `className` for layout only. Component colors and typography are changed
  through variants or shared CSS variables; conditional classes use `cn()`.
- Forms use `FieldGroup`, `Field`, `FieldSet`, and the matching shadcn controls;
  validation exposes both `data-invalid` and `aria-invalid`.
- Use `Alert`, `Empty`, `Badge`, `Separator`, `Skeleton`, `Spinner`, and Sonner
  for their corresponding states instead of one-off equivalents.
- Dialog, Sheet, Drawer, grouped menu/select items, Tabs, Cards, Avatars, and
  icon buttons follow shadcn composition and accessibility requirements.
- Use Lucide component imports consistently. Icons inside shadcn controls rely
  on component sizing and use `data-icon` where required.
- Preview upstream component changes with the shadcn CLI before merging; never
  overwrite local component changes without review.

## Color modes

OpenRUM supports light, dark, and system appearance modes within the single
Citrus theme. The public site and design previews default to dark; the console
retains its system preference. Theme choice is applied before rendering to
prevent a flash of the wrong theme.

`data-theme-scope="light"` supplies an explicit local light palette for the
static reference's alternating sections, even when the surrounding page is
dark. Components inside still use the same semantic variable names.

## Chart color contract

Series retain the same hue for strokes, bars, points, legend swatches and area
fills in both modes. Use opacity for secondary fills, not darker olive outlines.
Small chart text stays neutral; bright chart colors are not text colors.

The visual workbench maps its Recharts series to shared roles:

| Role           | Token                                         | Use                                      |
| -------------- | --------------------------------------------- | ---------------------------------------- |
| Primary series | `--ds-chart-1` → lemon green                  | Lines, bars, points and area outlines    |
| Second metric  | `--ds-chart-2` → teal                         | Another metric on the same unit axis     |
| Theme accents  | `--ds-chart-3`, `--ds-chart-4`                | Green and mint categorical accents       |
| Theme repeat   | `--ds-chart-5` → lemon green                  | Same as chart 1; not a distinct category |
| Prior period   | `--ds-chart-comparison` → pale yellow         | Same metric, dashed line                 |
| Status         | `--ds-success`, `--ds-warning`, `--ds-danger` | Ratings and thresholds                   |
| Area fill      | `--ds-chart-area` → primary                   | Translucent volume under a clear outline |

Chart 1–5 reproduce the reference theme (`#b8e954`, `#45807a`, `#a2e400`,
`#99e0d3`, `#b8e954`). The reference's comparison stroke is
`oklch(0.9002 0.137175 94.1925)`. It does not indicate a warning. Avoid using
repeated or similar greens as the only way to distinguish categories.

Axes, annotations and tooltips use neutral text; grids and cursors use borders.
Performance trends use chart 1; their success/error thresholds and rated Route
bars retain status colors. Error-rate series retain danger. Pair status color
with a label or icon. Each chart exposes its values through a tooltip or table.
For rated bars and gauges, `--ds-chart-success` supplies lemon green and
`--ds-chart-warning` golden yellow; poor ratings use danger. Keep their badge
text and threshold annotations on the darker success/warning tokens. The
warning fill has its own semantic role, separate from period comparisons.

When a chart stacks bands of very different magnitudes, stroke only the band
that carries the volume. Several stacked strokes inside a few pixels read as
one continuous line in the topmost color and misreport the whole chart.

The existing shadcn Chart primitive lives in `packages/ui/src/chart.tsx` and
is re-exported at its existing console import path. The workbench uses that
same primitive through an isolated `client:visible` React island. Example
charts use fixed data and disable animation to keep comparisons stable.
Live console charts retain `isAnimationActive={useChartMotion()}`.

## One unit per axis

By default, a panel plots a single unit on a single axis. Series that share an axis can be
read against each other; series on twin axes cannot, because the vertical
distance between them is set by the axis ranges rather than by the data. Both
the API trend and the dashboard's trend row were rebuilt for this reason: the
earlier versions overlaid counts, milliseconds and a percentage on two axes.

Split by unit instead. The dashboard pairs a counts panel (PV, UV) with a
percentage panel (error rate, API failure rate), and gives each Core Web Vital
its own panel because LCP and INP are milliseconds while CLS is a unitless
score. Values that are worth reading per bucket but cannot join the scale ride
in the tooltip.

Every trend panel needs a non-visual equivalent. The dashboard uses one
`<details>` table for the whole row rather than one per chart, because the
panels plot the same buckets and reading them against each other is the point.

Recharts is the charting library. It is the only one — a single ECharts holdout
on the dashboard was migrated so the bundle stops shipping two.

The performance workspace is an explicit user-requested exception (2026-09-12):
show real Web Vital values in one chart, not normalized percentages. Timing
metrics share the left millisecond axis and CLS uses a labeled right unitless
axis. Explain that cross-axis heights cannot be compared, retain raw tooltips,
and let users hide series. Do not extend this exception to unrelated charts.

## Documentation site

`apps/site` maps the design tokens onto Starlight's `--sl-*` variables in
`src/styles/global.css`, and the documentation-only overrides live in
`src/styles/docs.css`. Three of those mappings exist because the obvious version
was wrong, and are worth not undoing:

**Starlight's grey ramp keeps `gray-1` through `gray-3` as text colours** and
only becomes hairlines at `gray-4`. Mapping `gray-3` onto `--ds-border` painted
hairline-coloured text at about 1.2:1 everywhere Starlight draws secondary text
— the edit link, tab labels, LinkCard descriptions, FileTree icons — which Axe
reports as a serious violation. The ramp is shifted by one so text stays
readable.

**Both ends of the accent ramp come from `--ds-brand`.** Starlight reads
`--sl-color-accent-high` as link text on dark surfaces and `--sl-color-accent`
as link text on light ones. Both now intentionally resolve to neutral
`--ds-text`: charcoal in light mode and light grey in dark mode. Underlines
distinguish prose links from surrounding text.

**The `a` colour reset in `global.css` is unlayered**, which means it outranks
any `@layer` rule no matter the specificity. It is there because marketing
components colour their own links, and it has now caused the same class of bug
twice.

First it made every documentation prose link render as body text, outranking
Starlight's `@layer starlight.core` link colour. `docs.css` explicitly styles
`.sl-markdown-content` links and underlines them. Keep those underlines now
that the chosen link color is intentionally neutral.

Then it outranked `.ui-button-primary` in `@layer components`, so every
anchor-shaped primary button inherited body text instead of
`--ds-primary-foreground`. In light mode that still passed, which is why it
shipped; in dark mode it painted near-white text on the lemon-green fill at
1.12:1. The rule is now `a:not(.ui-button)`, which leaves buttons to the
layered rule rather than fighting it with a counter-override. The dark theme is
covered by its own Axe assertion in `tests/e2e/public-site.spec.ts`, because the
rest of the accessibility suite only ever loaded the light theme.

Any new global element rule in `global.css` carries the same hazard.

Documentation diagrams are Mermaid sources in `docs/diagrams/`, rendered to SVG
by `pnpm docs:generate` and committed. Mermaid rejects CSS variables in its
theme configuration, so the generator feeds it sentinel colours and swaps them
for design tokens in the output; the inlined SVG then follows the reader's
theme, costs no client JavaScript, and keeps the site build free of a headless
browser. `pnpm docs:check` fails when a source and its SVG have drifted.

## Landing page

The landing route is gated harder than any other page: `site:check` requires
Lighthouse performance, accessibility and SEO at 90 or better, LCP under 2.5s,
CLS under 0.1, total blocking time under 200ms, and **zero external scripts**.
A product that sells Core Web Vitals cannot regress its own.

The accepted centered homepage direction is `output/site-redesign/v2.html`,
with the later requested 56px navigation (frosted from the initial view,
no bottom border) and black/white
CTA pair. The user explicitly approved the Light Rays background. Its shader is
adapted from React Bits into a small native renderer; React and OGL are not loaded.
The existing performance thresholds remain in force.

`LightRays.astro` loads the renderer after the first paint during idle time. It
caps pixel density and rendering at 30fps, suspends offscreen and in hidden tabs,
with no visible playback controls. Reduced motion uses the static light field, which
also remains available if WebGL fails. Colors are read from the shared tokens;
shader/source attribution is in `public/licenses/`. The background is decorative,
so headings, navigation and actions remain native HTML with no dependency on it.
The rays cover the top of the page behind the frosted navigation, with their
source 20% of the background height above the viewport, matching the original
top-center placement. The unchanged React Bits shader overlays the Hero content
at z-index 3 with pointer events disabled, so the light tints text and buttons
without intercepting clicks. Only the bottom 15% is masked to join the next section.
Dark mode uses the user's light-ray color token and parameters: speed 1, spread
0.5, length 3, mouse influence 0.1, fade distance 1, saturation 1, no noise,
distortion or pulsation. Light mode keeps the previous muted green treatment.

Buttons use the shared `ui-button-contrast` and `ui-button-neutral` variants:
white/black in dark mode and black/white in light mode. Hover applies a small
lift, a neutral fill adjustment and arrow movement; buttons have no continuous
sheen or colored glow. The logo is an open ring with a signal, and the Space
Grotesk wordmark is outlined SVG, preserving neutral Open and theme-colored RUM
without adding a font request. Product typography remains Geist.

The hero is centered: title, description, Get started/GitHub, then a compact
technology-icon row with hover/focus labels. Three feature cards follow. The
existing detailed product and self-hosting sections remain below them.
The English subtitle is: “Track errors, analyze user behavior, and monitor
application performance — all on your own infrastructure.” Keep this wording.

Three constraints shape how the file is written:

**Every class is `lp-` prefixed** and the file is imported only by
`components/landing/LandingPage.astro`. The other marketing pages still share
`.section`, `.card-grid`, `.feature-card` and `.proof-grid` from `global.css`,
so landing styles must not reach them. Restyling the landing meant deleting the
old landing-only rules (`.hero*`, `.path-preview*`, `.flow-*`,
`.section-heading`, `.section-muted`) from `global.css` rather than leaving them
as dead weight.

**No raw colour literals.** `design:check` rejects `#hex`, `rgb()`, `hsl()` and
`oklch()` anywhere under `apps/site/src`, so every tint is a
`color-mix(in oklch, …)` over a `--ds-*` token. This applies to SVG too: the
sparkline's gradient stops are styled by CSS class rather than `stop-color`
attributes.

**Scroll-linked reveals are progressive enhancement.** `.lp-reveal` sits behind
`@supports (animation-timeline: view())` and animates only `opacity` and
`transform`, so browsers without scroll-driven animations render the final
state and no variant can spend the page's CLS budget. The global
`prefers-reduced-motion` reset in `global.css` already neutralises the ambient
animation.

The headline has separate block-level lines so the two sentences never run
together; desktop uses two lines and mobile wraps within a stable centered
measure. Entry animation is limited to transforms and opacity, with reduced-motion
support. The terminal block must continue matching the quickstart command.

## Typography

Use Geist Variable with Inter and system sans fallbacks for product text, and JetBrains Mono
for endpoints and metric keys. Numbers use tabular variants. Main title is 24px,
section titles 16px, and product body, table body, and default control text 14px.
Table headings and supporting metadata are 12px. Normal product content must not
fall below 12px.

## Console density and component sizing

The project Settings workspace is the density reference for the Console. The
default is comfortable rather than compact: controls have enough height for
Chinese labels, forms keep visible grouping, and tables remain scannable over
long sessions. Use the shared shadcn primitives so these dimensions come from
one implementation rather than page-level utility overrides.

| Element                         | Default                                                     | Compact / exception                                          |
| ------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------ |
| Button, Input, Select           | 40px high, 14px text                                        | 32px only for secondary inline actions and toolbars          |
| Large or mobile-critical action | 44px high                                                   | Use when the action is isolated or touch-first               |
| Icon button                     | Same height and width as its matching text control          | 28px is reserved for dense table actions and icon rails      |
| Textarea                        | At least 96px high, 14px text, 24px line height             | Increase by content; do not compress multi-line settings     |
| Form fields                     | 20px between fields; 24px between semantic sections         | Related micro-controls may use 12–16px                       |
| Settings section                | 24px inner padding on desktop, 16px on narrow screens       | Do not reduce padding just to fit more fields above the fold |
| Table header                    | 40px high, 12px text                                        | Keep labels concise instead of shrinking text                |
| Table body row                  | At least 44px high, 14px text, 16px horizontal cell padding | Multi-line identity rows may grow beyond 44px                |

Compact density is an explicit variant, not a page-level default. It is valid
for the sticky status bar, sidebar icon rail, table row actions, and dense query
builders where surrounding labels already provide context. Primary forms,
settings pages, empty states, and main calls to action always use the default
size. At touch breakpoints, interactive targets must be at least 44px even when
the desktop composition uses a compact variant.

## Layout inventory

- 188px expanded / 64px collapsed hierarchical sidebar. The brand returns to
  the project list and reveals project/environment switching on hover or
  keyboard focus; there is no separate switcher card.
- The main sidebar exposes the observation areas plus one **项目设置** entry.
  Lower-frequency Project tools live in the Project Settings contextual rail;
  personal, Organization, notification, and Instance settings live in the
  account menu.
- One sticky app status bar spans every authenticated workspace page. Its right
  edge owns global utilities such as appearance, future language, and
  notifications. It does not own page filters.
- Console pages that expose contextual navigation use a two-column frame below
  the status bar: a 208px `ContextRail`, followed by the main page column with
  a 32px gap. Pages without contextual navigation use the full content width.
  Below 1024px an enabled rail moves into a Drawer.
- Main-column widths are controlled variants: `fluid` has no maximum for charts
  and analysis, `wide` caps lists and management at 1280px, and `narrow` caps
  forms and settings at 1024px. A contextual rail stays in the page's left
  column and does not consume that main-column allowance. Page padding is 32px
  desktop, 24px tablet, and 16px mobile.
- The main column orders a 24px title with right-side actions, optional 14px
  description, local tabs, an optional `ConsoleFilterBar`, then content. Loading,
  error, and empty states replace content without changing this frame.
- `ConsoleFilterBar` is a placement surface rather than a query schema. Pages
  freely compose shadcn search, time, facet, and advanced-filter controls in its
  primary and secondary regions. It may be sticky on long list pages only.

## Product information hierarchy

Overview cards keep the default view quiet: title and main value or chart.
Stat cards place a left-aligned previous-period change badge with "较上一周期"
below the number, then one muted line explaining the metric. Reserve the
top-right for the details icon so it does not compete with the comparison.
Rising PV/UV uses the positive token;
rising errors, API failures and Web Vital values use the negative token.
No comparison, insufficient samples and rounded-zero changes stay neutral.
Use an icon that appears on hover or keyboard focus to open a details Dialog;
keep the entry visible on touch/narrow screens. Move repeated descriptions,
sampling notes, receive timestamps, previous values and chart data tables into
the dialog. Keep a small delayed-data indicator visible beside the title.
Explicitly configured table views remain tables. Reuse the loaded query result
for details, without new requests or configuration writes. Dialog tables show
unabbreviated counts and milliseconds; provide a scrollable body, a visible
close action and focus return to the trigger.

The performance workspace uses the full available content width. Its first
analysis layer retains the OpenRUM performance score alongside real overall LCP,
INP, CLS, FCP, and TTFB values. One SVG segmented score ring shows the total
in its center and the metric names directly outside their sectors, with no
separate legend beneath. Sector capacity follows the metric's default score weight;
the colored part
shows the earned score and a neutral track shows the remainder. Preserve Citrus
series colors and use INP rather than the reference image's legacy FID label.
Center the total using SVG middle text anchoring and a central dominant baseline,
so font x-height does not shift the number above the ring center.
The ring sits beside a combined date-based chart of raw values:
LCP, INP, FCP and TTFB share the left millisecond axis; CLS uses the right
unitless axis. Do not plot normalized percentages or score contributions. Series have distinct colors and line patterns, may be hidden independently,
and never all at once. Offer only P50, P75 and P95 in a compact dropdown at the
chart top right. Place small, muted metric toggles inside the white/theme-aware
card content below the plot, without a gray footer, divider or outlined pills;
retain off-state and keyboard-focus indicators.
Remove the page-wide metric toolbar. Below the chart row, five compact cards
show real values, independent sample counts, and a P75 rating/score footer.
All five metrics participate using [Sentry's default weights](https://docs.sentry.io/product/dashboards/sentry-dashboards/frontend/web-vitals/#performance-score):
LCP 30%, INP 30%, CLS 15%, FCP 15%, TTFB 10%. The total and ring share one weight
definition. Only the weights follow Sentry, not its log-normal scoring model or
device-specific thresholds. Ratings
always use P75 thresholds; fewer than 75 samples means insufficient evidence,
not failure. Preserve the existing OpenRUM 0–100 scoring curve (90 at the good
threshold, 50 at the poor threshold, piecewise linear and clamped) and take the
weighted mean of available overall P75 metric scores. Label incomplete or low-sample
scores as reference; missing metrics are excluded rather than filled with zero
or a perfect score. Reference totals renormalize the available metrics' weights;
missing metrics retain their default-size neutral ring sectors, not an earned score.
The score remains independent of chart percentile/visibility and is not a Sentry
or Lighthouse score or CWV status. Overall
percentiles come from the matching sample population, never averages of route
percentiles. The route table sorts by the selected metric/percentile and opens
route trends, distribution, dimension comparisons, and slow samples.

The API retains all five percentiles for compatibility, while the Console
offers only P50/P75/P95. Queries use retained, non-synthetic raw events, with
finite nonnegative values and independent counts per metric.
Auxiliary metric reference thresholds follow [FCP](https://web.dev/articles/fcp)
(1800/3000 ms) and [TTFB](https://web.dev/articles/ttfb) (800/1800 ms).
The SDK collects all five supported Web Vitals; previously deployed SDK builds
must be upgraded before real FCP/TTFB samples appear. Missing values stay empty.
The existing Nullable TDigest aggregate states cannot be finalized at arbitrary
levels on ClickHouse 25.8; do not estimate P95 from P75 or silently mix raw and
aggregate retention windows. A selected date range beyond raw-event retention
may be incomplete. Trends and overall values are independently calculated;
histogram overflow buckets must be labelled as unbounded, not as closed ranges.

`AnalysisFilterSidebar` is the reusable right-side dimension-filter surface,
initially shared by Performance and Issues. Each page supplies only dimensions
its backend supports. At 1280px and above it is collapsible and persists the
presentation preference locally; below that it becomes a Sheet. Draft changes
apply together, combined dimensions use AND, and active chips remain visible
when collapsed. Applying/removing filters updates the URL and resets pagination;
browser Back restores the previous query. Clear dimensions must not clear global
time/environment, the selected metric, or percentile. Route matching is exact.
Performance suggestions omit their own active dimension when computing options,
retain other filters, and return at most 100 values ordered by sample count.

The project list is an operational landing surface rather than a settings
index. Each project card leads with the previous 24 complete hours of PV, UV,
error events, PV trend, and reporting freshness. Sampling, retention, and other
configuration metadata stay in the footer so users can first answer whether a
project is receiving traffic and whether it needs attention.

- The nine first-level product areas, in order, are **数据大盘、分析、错误、性能、事件、API、告警、会话、设置**. “探索” is the advanced filtering mode inside Sessions; “洞察” is reserved for future system-generated findings.
- 数据大盘 is the landing surface: the signed-in root, the project switcher, and the onboarding magic moment all resolve to it. It owns the range-wide KPI row and the cross-cutting trend panels, and it answers “is this project healthy” without owning any diagnosis. Every panel on it links into the area that does.
- 分析 owns PV/UV, acquisition, audience dimensions, funnels, paths, retention, and saved analyses.
- 错误 owns error groups, impact, Source Map diagnostics, and the reverse link to affected behavior and sessions.
- 性能 owns Web Vitals, page/route performance, resource timing, distributions, and slow samples.
- 事件 owns the event catalog, event trends, custom properties, raw event samples, and user/session timelines.
- API owns browser request volume, failure rate, latency, normalized endpoints, and request samples.
- 告警 owns product-quality rules, notification state, history, and investigation deep links.
- 洞察 synthesizes meaningful changes across behavior, errors, performance, events, and APIs; every insight must show its evidence and open a filtered investigation rather than present an unexplained score.
- 项目设置 owns project configuration, SDK keys, data/privacy rules, releases, usage, and quota. Organization membership, notification channels, appearance, and Instance administration remain account-scoped.
- 接入、发布、用量、配额与开发造数据统一收进 **项目设置** 的上下文导航，不再占用主侧边栏入口。
- 组织与成员、通知渠道、实例级系统设置统一从底部账户菜单进入；实例级设置仅对管理员显示。
- Visual polish is part of the product promise for self-hosted users: analytics screens must preserve the same readable type scale, clear empty states, URL-backed filters, light/dark themes, and keyboard behavior as error screens.

## Component families

- App shell, sidebar navigation, project switcher, operator card.
- Select controls, tabs, buttons, status badges, KPI cells.
- Responsive line chart with release marker and custom tooltip.
- Country/device/browser/custom-dimension analysis panel.
- Custom telemetry query builder and channel breakdown.
- Ranked issue list, API health table, compact trend sparklines.

## Core interaction contract

- Every project data-analysis route composes time into its page filter bar and
  preserves the same scope when the user changes pages. Environment selection
  lives in the project switcher's hover panel and updates the same URL-backed
  analysis context. The sticky app status bar remains reserved for global
  utilities rather than page filters.
- The time-range trigger opens a non-modal shadcn Popover. Its panel combines
  relative presets from the last 5 minutes through the last 30 days with a
  two-month range Calendar and local start/end time fields. Absolute ranges may
  not exceed 30 days and remain encoded in the URL for sharing.
- Environment provides all environments, Production, Test, and the project's
  configured environment. Page titles, queries, exports, and empty states must
  reflect this shared value rather than assuming Production.
- Page-specific filters such as release, route, event, browser, issue status, or
  API endpoint remain inside the page header or advanced-filter surface. They
  never duplicate the global time/environment controls.
- Changing the shared context clears pagination but preserves unrelated
  page-specific URL filters. Each project remembers its own last-used analysis
  context locally.
- Audience tabs switch between country, device, browser, and custom-dimension views.
- Compare toggles a comparison state with a visible confirmation.
- Custom query fields are editable and “创建自定义查询” adds a saved query notice.
- Issue and API rows are selectable and open a local detail drawer.

## Responsive behavior

At tablet widths the sidebar collapses to an icon rail and the two-column modules
stack. At phone widths navigation becomes a compact top bar; KPI cells scroll
horizontally and tables preserve readable columns through horizontal scrolling.
