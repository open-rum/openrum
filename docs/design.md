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

The typography section includes a font-selection preview: IBM Plex Sans (current),
Geist, Inter, Manrope and Exo 2 for Latin text, paired independently with
system Chinese fonts or Noto Sans SC. Selections affect only the workbench and
persist in its `font` / `cjk` URL parameters; they do not change product defaults.
Compare editable text, KPI numbers, 14px tables, and chart labels. Reset restores
IBM Plex Sans and system Chinese. Fonts are self-hosted via Fontsource; Noto Sans SC's
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

Header brand lockups use one shared proportion: a 28px mark, an 18px wordmark,
and a 9px gap. The mark and outlined wordmark use optically cropped view boxes so
their visible shapes align instead of aligning their source-canvas whitespace.
Favicons use a tighter crop because they do not include a neighboring wordmark.

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
- Typography: IBM Plex Sans Variable with system Chinese fallback; the Space Grotesk
  wordmark uses SVG outlines. Marketing display sizes are 56 / 38px and
  section headings 40 / 30px. Product UI uses a comfortable 12–14px scale.

### Light-mode Citrus accent hierarchy

Light mode keeps neutral canvas, cards, typography, borders, tables, and primary
actions. A page's main submit or create action uses the black/white contrast
tokens; lemon green is not the default button fill.

Use lemon green in small, semantically meaningful regions:

- selected choices and active form options use `--ds-selection`,
  `--ds-selection-foreground`, and `--ds-selection-border`;
- compact badges, icons, switches, progress, focus rings, and data-series marks
  may use `--ds-primary` with `--ds-primary-foreground`;
- use one or two green anchors per content group rather than tinting the whole
  card or section;
- hover without selection remains neutral, so green continues to mean selected,
  enabled, or currently effective;
- success, warning, danger, and information states retain their own semantic
  tokens and must not be recolored as Citrus decoration.

The Rate Limits settings page is the reference composition: neutral cards and
black submit action, lime summary marks and effective-state badges, and a pale
lime surface plus stronger lime border for selected source and strategy options.
The same pattern should be reused by other Console settings forms.

## Landing concepts

- `/` is the centered Stroke Text headline homepage, without the Light Rays background.
- The second content floor after the feature Bento is `Reliability.astro`
  (`#architecture`): five service layers, independent-scaling highlights and
  sourced performance evidence. Layer grouping is not a sequential request
  path; write and query paths are spelled out separately. Benchmark figures
  come from `content/evidence/local-capacity-2026-09-18.json` and must retain
  the local-machine label, CPU/core count, host RAM versus Docker VM RAM,
  test duration/load, gate status and unvalidated production-concurrency status.
  Both the homepage and Benchmarks page consume the same evidence. Retain the
  historical failed runs; do not turn a short passing run into a sustained-load
  or production-capacity claim. Public download is a static sanitized JSON file,
  never the private benchmark credential directory.
  Do not relabel target EPS/QPS as measured throughput or supported concurrency.
- Its feature overview uses `FeatureBento.astro` after the technology strip:
  analytics and errors are the two large cards (7/5 columns); sessions,
  performance, API monitoring and alerts form four smaller cards. The alert
  illustration connects a metric rule to a team IM notification through Webhook;
  it does not imply native integrations with specific IM providers.
  At 1100px the grid becomes two columns, and at 600px one column. Use shared
  Citrus surfaces, typography and radii, with lime data accents. Illustrations
  are static HTML/SVG, explicitly labelled as example data, and cards link to
  the corresponding localized documentation. Maintain keyboard focus and
  reduced-motion support; do not imply an interactive Console or Session Replay.
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

| Role                | Token                                         | Use                                      |
| ------------------- | --------------------------------------------- | ---------------------------------------- |
| Primary series      | `--ds-chart-1` → lemon green                  | Lines, bars, points and area outlines    |
| Categorical palette | `--ds-chart-1` … `--ds-chart-10`              | Up to ten discrete, unordered categories |
| Prior period        | `--ds-chart-comparison` → pale yellow         | Same metric, dashed line                 |
| Status              | `--ds-success`, `--ds-warning`, `--ds-danger` | Ratings and thresholds                   |
| Area fill           | `--ds-chart-area` → primary                   | Translucent volume under a clear outline |

The categorical order is lemon, blue, orange, violet, teal, coral, cyan,
magenta, gold and slate. Keep this fixed order across the console. Do not derive
colors from the array length or generate random hues during rendering: that
makes a category change color when data refreshes. For more than ten categories,
show the nine most important categories and combine the remainder into `Other`
using chart 10. A stable hash may select from this palette when a domain needs
the same named category to retain its color across separate charts, but the
palette remains fixed and collisions still need labels or direct interaction.

The comparison stroke is `oklch(0.9002 0.137175 94.1925)`. It does not indicate
a warning. Never rely on color alone: categorical charts retain labels, legends
and tooltips, and line charts distinguish overlapping series with dash patterns.

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

Console Line/Area trends share `apps/web/src/lib/charts/smoothCurve.ts`:
monotone-X interpolation and rounded stroke caps/joins. Apply it to page charts,
Stat mini charts, editor previews and enlarged details alike. Curves pass through
the measured samples without creating new local extrema; never smooth the data
by averaging or removing peaks. Preserve null gaps and show a resting dot only
for an isolated Dashboard sample, not every sample merely because a gap exists.
Bar and distribution views retain their configured visualization type.

Console time-series charts and Stat mini charts share a target of at most
approximately 30 backend-aggregated points at every viewport width. Short ranges
may return fewer; calendar alignment can add one partial edge bucket. Keep gaps
as null, not synthetic zeroes. Resizing/enlarging changes presentation only;
time labels still adapt to available width.
Read [the time-series implementation standard](agents/time-series.md) before
adding or changing trends. It defines source-resolution floors, the interval
table, API fields, shared code entry points and the remaining legacy consumers.

Category Bar breakdowns are ranked lists, not small axis-heavy plots. Place
the category name and existing metadata icon on the left, exact value and share
on the right, and a thin lime bar below. Use a shared zero baseline and scale to
the largest returned group; do not assign arbitrary rainbow colors to rankings.
Shares describe the full returned group sum, not only visible Top 10 rows.
Show all returned groups in enlarged details and disclose overlapping unique
counts/query limits. Keep values visible without hover and long lists keyboard
scrollable. This styling does not apply to time-series Bars.

Dashboard donut distributions pair a left ring with a right ranked list. Use
existing Chart/Table primitives, neutral typography, fixed chart tokens, and
always-visible exact values and shares. These compact rings keep up to six
slices; above six, show the five largest and combine the remainder using chart 10.
The accessible details table keeps every returned group. Label percentages as
shares of returned group counts; disclose query limits and user/session overlap,
never imply a sum of group uniques is a globally distinct count. Stack ring/list
on narrow cards and give keyboard focus the same highlight as pointer hover.

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
CTA pair. The hero no longer mounts the Light Rays background or its WebGL renderer.
The two-line heading uses the supplied React Bits StrokeText component with GSAP:
SVG character outlines draw progressively with staggered stroke-dash offsets, then
a horizontal wipe fills the text only after the last character finishes drawing.
Do not replace the drawing phase with a static CSS outline. Hidden native text
reserves the layout; await fonts and initialize the SVG dash/clip state before
revealing it. The SVG uses those font metrics and baseline, without glyph-bounds
padding or a visible solid-HTML-to-SVG swap. Resizing must not restart the animation.
The first line uses the foreground token; the second draws in Citrus primary and
fills with the accessible brand token. Keep the existing localized copy and typography.
Without JavaScript, the reserved text is shown as a static outline.
Reduced motion shows the completed heading without animation. All animation resources
are bundled locally; the existing performance thresholds remain in force.

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
below the number; keep metric descriptions in configuration/details. Appearance
choices are plain, right-side smooth line and right-side bar. Both mini charts
reuse real buckets, preserve missing-data gaps and stay display-only. Retired
bottom-line/area appearances fall back to the right-side line. Reserve the
top-right for the settings menu icon so it does not compete with the comparison.
Rising PV/UV uses the positive token;
rising errors, API failures and Web Vital values use the negative token.
No comparison, insufficient samples and rounded-zero changes stay neutral.
Use an icon that appears on hover or keyboard focus to open the card settings menu,
including enlarge/details; no prior page edit action is required. Keep the entry
visible on touch/narrow screens. The page edit action is icon-only, without a
refresh button. Card mutations start a Save/Cancel draft; menu/details opening
does not. Move repeated descriptions,
sampling notes, receive timestamps, previous values and chart data tables into
the dialog. Keep a small delayed-data indicator visible beside the title.
Explicitly configured table views remain tables. Reuse the loaded query result
for details, without new requests or configuration writes. Dialog tables show
unabbreviated counts and milliseconds; provide a scrollable body, a visible
close action and focus return to the trigger.

The dashboard menu calls this action **详细**. Its detail workspace is capped at
1160px and the viewport height, with a persistent title/close row, a large chart
or exact-data Table tab, and a 280px statistics/context rail. Stat details lead
with current value, previous value and semantic period change. At narrow widths
the rail stacks below the main content. Preserve the true bucket interval and
all returned categories; opening details never reaggregates or queries again.
All dashboard details retain the existing shadcn Dialog's default motion; do not
add source-card flip/expand or return animations. Keep this layout isolated from
other Console pages until explicitly adopted, without overriding shared Dialog defaults.

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
- 项目设置 exposes **常规、接入指引、数据管理、用量统计**. Data management groups **采样配置、速率限制、入站过滤、URL 归一化、隐私脱敏** into route-backed page tabs with one shared header, width and task description. The sidebar highlights 数据管理 across those routes; keep existing deep links and independent saves. Sampling is `/settings/project/:projectId/sampling`, separate from the report at `/settings/project/:projectId/usage`. A failed usage estimate must not hide sampling controls. Organization membership, notification channels, appearance, and Instance administration remain account-scoped.
- 接入、发布、用量、配额与开发造数据统一收进 **项目设置** 的上下文导航，不再占用主侧边栏入口。
- 组织与成员、通知渠道、实例级系统设置统一从底部账户菜单进入；实例级设置仅对管理员显示。
- Visual polish is part of the product promise for self-hosted users: analytics screens must preserve the same readable type scale, clear empty states, URL-backed filters, light/dark themes, and keyboard behavior as error screens.

## Component families

### Organization usage statistics

`/usage` is an organization-level page, separate from the project picker and
project-scoped analysis. It is the only organization-level sidebar item above
project navigation; clicking the brand/Logo remains the sole entry to the Project
list. It compares accessible projects across all environments,
with URL-backed organization, time and event-type filters, aggregate outcome
cards, a stacked outcome trend and a searchable table sorted by accepted volume.
Search filters only the table. Project detail links retain time and event type.

The console reuses permission-checked project usage endpoints with at most four
concurrent requests. Partial failures are explicit; failed rows do not become
zero and shares are hidden until all projects load. Summaries use API totals,
not the capped reason breakdown. At the current 5,000-row breakdown cap, hide
the trend and recommend a narrower query. Transfer bytes are not disk usage;
accepted volume share is not quota consumption, and processing outcomes are
not necessarily disjoint unique events. Client-side losses not reported to the
server cannot be represented as complete counts.

### Project list presentation

The project list offers three locally remembered views of the same API data:
lightweight cards for quick entry, expanded trend cards for inspection, and a
table for cross-project comparison. Keep the view switch labeled and keyboard
accessible. All views share query-cache entries, show the last 24 hours in each
project's default environment, and preserve PV, approximate UV, error events,
reporting freshness and project entry. Do not turn missing or failed summaries
into zero values, or render synthetic trends when there are no samples. Tables
scroll horizontally on narrow screens; cards stack and controls wrap.

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
