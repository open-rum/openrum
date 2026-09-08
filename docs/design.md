# OpenRUM frontend design system

## Source of truth

The accepted overview concept is `output/imagegen/openrum-dashboard-stripe.png` at
1440 × 1024. It defines the initial frontend shell and overview information
architecture, not the current palette. The user-supplied
`OpenRUM_Landing_Page_Spec_v1.docx` adds the current brand mark, Acid Green
palette, and a separate landing-page reference concept.

## Visual workbench

`apps/site/src/pages/design/index.astro` publishes `/design/`: brand assets,
palette presets, semantic colors, typography, spacing, radii, material, and
Area / Bar / Line chart examples. It is a site route, not a package or a
component-library application. The page reads actual CSS custom properties;
it does not maintain a second table of color values.

Shared foundations remain in `packages/design-tokens`:

- `tokens.css`: base roles, Citrus compatibility palette, and design scales.
- `presets.css`: Acid Green and Graphite overrides, including light ink.
- `catalog.ts`: palette identifiers, default selection, and display metadata.
- `brand.ts`: the two paths of the document's rounded, split-ring SVG mark.

The site, documentation, and console apply `data-palette` to the root. The
workbench stores the selection as `openrum-palette` in local storage; preview
links carry `?palette=acid&theme=dark` so a comparison can be shared. Storage
is per origin: site and console on different ports do not share preferences.
The console accepts the palette query parameter as well.

| Preset               | Character                                | Light treatment                                 |
| -------------------- | ---------------------------------------- | ----------------------------------------------- |
| Acid Green (default) | Document's `#C8FF3D`, cool dark surfaces | Warm off-white, near-black text, deep olive ink |
| Citrus               | Previous OpenRUM palette                 | Neutral white surfaces, dark citrus ink         |
| Graphite             | Muted sage with graphite surfaces        | Soft neutral surfaces, deep forest ink          |

The brand mark is reconstructed from the document's raster reference. It uses
shared SVG geometry in Astro and React, with a monochrome wordmark. `/design/`
provides themed SVG downloads and variants. The favicon is a static copy of
that geometry; update both apps' favicons when changing the shared mark.

## Visual language

- Acid Green is the initial preset; selecting Citrus restores the previous
  palette without changing component CSS.
- Bright primary fills and darker brand ink are separate roles. Light-mode
  text, links, controls, and fine chart strokes use deep colors.
- Main homepage actions remain black and white. Landing concept 01 follows the
  document's green action in dark mode and a dark action in light mode.
- Error, warning, and success remain independently recognizable and pair
  color with labels, shapes, or icons.
- Radius: 5 / 7 / 9px. Shadows are limited to controls and elevated surfaces.
- Typography: Geist Variable with system Chinese fallback; the Space Grotesk
  wordmark uses SVG outlines. Marketing display sizes are 56 / 38px and
  section headings 40 / 30px. Product chrome remains compact at 12–14px.

## Landing concepts

- `/` is the existing centered headline / Light Rays homepage.
- `/design/landing/01/` is the static document reference: split Hero, product
  mockups, trust strip, features, errors, analytics, performance, platforms,
  self-hosting, and open-source CTA. Mockups contain clearly labelled sample
  data. Planned SDKs remain marked Roadmap.
- `/design/landing/` compares independent pages in scalable desktop, tablet,
  and mobile viewports. Both previews receive the same selected palette and
  theme. The scheme's Analytics and Self-hosting sections intentionally use
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

OpenRUM supports light, dark, and system appearance modes. Preset selection
is independent from appearance. The public site and design previews default
to dark; the console retains its system preference. Theme choice is applied
before rendering to prevent a flash of the wrong theme.

`data-theme-scope="light"` supplies an explicit local light palette for the
static reference's alternating sections, even when the surrounding page is
dark. Components inside still use the same semantic variable names.

## Chart color contract

`--ds-primary` is the bright accent fill, while `--ds-brand` is legible ink.
They are equal in dark mode for Acid Green and Citrus; light mode uses a
much deeper brand ink. Never use the bright accent for small text on white.

The visual workbench maps its Recharts series to shared roles:

| Role           | Token                       | Use                                      |
| -------------- | --------------------------- | ---------------------------------------- |
| Primary series | `--ds-chart-1` → brand ink  | Bare lines, bars, area outlines          |
| Comparison     | `--ds-chart-2` → secondary  | Secondary lines and bars                 |
| Neutral        | `--ds-chart-3` → muted text | Reference series                         |
| Warning        | `--ds-chart-4` → warning    | Degraded states                          |
| Error          | `--ds-chart-5` → danger     | Failures                                 |
| Area fill      | `--ds-chart-area` → primary | Translucent volume under a clear outline |

For light previews, bars and thin strokes deliberately use dark ink, as
requested. Translucent area fills retain the bright accent. Existing console
charts may still consume `--ds-primary` directly for filled marks; the preset
changes their colors without silently rewriting individual chart compositions.

Supporting series use a contrasting neutral or secondary color. Status series
keep their semantics and pair color with a label, shape, or ordering. Dashed
comparison lines provide an additional distinction in the Line example.

When a chart stacks bands of very different magnitudes, stroke only the band
that carries the volume. Several stacked strokes inside a few pixels read as
one continuous line in the topmost color and misreport the whole chart.

The existing shadcn Chart primitive lives in `packages/ui/src/chart.tsx` and
is re-exported at its existing console import path. The workbench uses that
same primitive through an isolated `client:visible` React island. Example
charts use fixed data and disable animation to keep comparisons stable.
Live console charts retain `isAnimationActive={useChartMotion()}`.

## One unit per panel

A panel plots a single unit on a single axis. Series that share an axis can be
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
as link text on light ones. Pointing `accent-high` at `--ds-text` made
dark-mode links exactly the colour of body text. `--ds-brand` already inverts
its lightness between modes, so it is correct at both ends.

**The `a` colour reset in `global.css` is unlayered**, which means it outranks
any `@layer` rule no matter the specificity. It is there because marketing
components colour their own links, and it has now caused the same class of bug
twice.

First it made every documentation prose link render as body text, outranking
Starlight's `@layer starlight.core` link colour. `docs.css` restores the colour
for `.sl-markdown-content` links and underlines them, since colour alone is one
signal and WCAG 1.4.1 asks for two.

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
section titles 16px, product body 14px, table/control text 12px, and supporting
metadata 11px. Normal product content must not fall below 11px.

## Layout inventory

- 188px hierarchical sidebar. The brand returns to the project list and reveals
  project/environment switching on hover or keyboard focus; there is no separate
  switcher card.
- One sticky app status bar across every authenticated workspace page. Its
  right edge owns global utilities such as appearance, future language, and
  notifications; analysis controls are slotted context rather than part of the
  permanent shell. Analysis overview, funnels, paths, and retention are separate
  routes grouped with page-level tabs; refresh remains in the page title row.
- Breadcrumb and page title row with release and time controls.
- Six equal KPI cells.
- Two-column trend/priority row, approximately 62/38.
- Two-column analytics/custom-data row, approximately 58/42.
- Two-column issue/API table row, approximately 58/42.

## Product information hierarchy

The performance workspace uses the full available content width. Its first
analysis layer pairs the experience health score with separate date-based LCP,
INP, and CLS P75 trend charts; Route ranking and the Route table form the next
diagnostic layer.

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
- 设置 owns project configuration, SDK keys, data/privacy rules, members, notification channels, appearance, and instance administration. Frequently used settings should remain one click from anywhere.
- 接入、发布、用量与项目设置 belong to a visually secondary project-management area and never compete with the nine first-level product areas.
- Visual polish is part of the product promise for self-hosted users: analytics screens must preserve the same readable type scale, clear empty states, URL-backed filters, light/dark themes, and keyboard behavior as error screens.

## Component families

- App shell, sidebar navigation, project switcher, operator card.
- Select controls, tabs, buttons, status badges, KPI cells.
- Responsive line chart with release marker and custom tooltip.
- Country/device/browser/custom-dimension analysis panel.
- Custom telemetry query builder and channel breakdown.
- Ranked issue list, API health table, compact trend sparklines.

## Core interaction contract

- Every project data-analysis route injects time and environment controls into
  the sticky app status bar and preserves the same scope when the user changes
  pages. The controls may move to another analysis surface later without
  changing the global utility shell.
- Time provides relative presets from the last 5 minutes through the last 30
  days, plus an absolute start/end range. Absolute ranges use the user's local
  timezone, may not exceed 30 days, and remain encoded in the URL for sharing.
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
