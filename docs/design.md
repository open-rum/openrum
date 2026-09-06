# OpenRUM frontend design system

## Source of truth

The accepted overview concept is `output/imagegen/openrum-dashboard-stripe.png` at
1440 × 1024. It defines the initial frontend shell and overview information
architecture, not the current palette. Color variables are adapted from the
[Shadcnblocks Citrus theme](https://www.shadcnblocks.com/theme/citrus); OpenRUM
retains its own accessible error, warning, and success semantics.

## Visual language

- Theme: Citrus from Shadcnblocks, adapted to OpenRUM's monitoring semantics.
- Background: near-white neutral (`oklch(0.9851 0 0)`) with clean white cards.
- Primary text: crisp neutral (`oklch(0.269 0 0)`).
- Rules and borders: neutral gray (`oklch(0.922 0 0)`).
- Primary fill and chart highlight: electric citrus
  (`oklch(0.8719 0.1829 125.59)`, approximately `#b8e954`) with black
  foreground.
- Secondary: deep teal (`oklch(0.5591 0.0631 185.87)`). Links and text-only
  active states use a darker citrus ink instead of the bright fill color so
  they remain readable on white.
- Semantic error/danger remains red instead of adopting Citrus's near-black
  light-mode destructive token; success and warning remain independently
  recognizable and never rely on color alone.
- Radius: 6–8px; shadows are limited to controls and elevated menus.
- Density: desktop reporting UI with compact 12–14px chrome and readable tables.

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

OpenRUM supports light, dark, and system appearance modes. Light mode uses the
Citrus near-white reporting surface. Dark mode uses Citrus neutral black
surfaces with the same electric citrus primary, deep teal secondary, and
OpenRUM semantic status colors.
Theme choice persists locally and is applied before React starts to prevent a
flash of the wrong theme.

## Chart color contract

The citrus hue ships as two tokens that are easy to confuse. They differ only in
whether the lightness is fixed:

| Token          | Light                         | Dark                          |
| -------------- | ----------------------------- | ----------------------------- |
| `--ds-primary` | `oklch(0.8719 0.1829 125.59)` | same                          |
| `--ds-brand`   | `oklch(0.46 0.112 125.59)`    | `oklch(0.8719 0.1829 125.59)` |

`--ds-brand` inverts its lightness between modes so citrus _text_ stays readable
on either surface. `--ds-primary` holds one lightness in both.

**Filled marks use `--ds-primary`.** Areas, bars, scatter points, map and
heatmap cells, and gradient stops that carry a quantity. A filled region has
enough area to read at low contrast, and `--ds-brand` renders dark olive on the
near-white canvas, which makes the chart look muddy and only correct in dark
mode.

**In-chart ink stays on `--ds-brand`.** Axis tick labels, annotation and
reference-line labels, hover crosshairs, release markers, and bare line strokes
that are not backed by a fill. These are thin or textual, so they need the
contrast that `--ds-brand` is tuned for; `--ds-primary` on white is too pale to
resolve at one or two pixels.

The dividing question is whether the mark has area to carry the color. When a
line does sit on top of its own fill, the fill carries the presence and the
stroke may take `--ds-primary` to match it.

Outside charts, `--ds-brand` remains correct for text, icons, borders, focus
rings, and `--ds-brand-soft` surfaces.

Supporting series use `--ds-secondary` (deep teal), and status series keep their
semantics: `--ds-danger` for failures, `--ds-warning` for degraded or
client-error states. Status color never carries meaning alone; pair it with a
label, shape, or ordering.

When a chart stacks bands of very different magnitudes, stroke only the band
that carries the volume. Several stacked strokes inside a few pixels read as one
continuous line in the topmost color and misreport the whole chart.

Charts animate by default. Recharts runs its transitions in JavaScript, so the
global `prefers-reduced-motion` rule cannot reach them; pass
`isAnimationActive={useChartMotion()}` instead of hard-coding it.

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

- The eight first-level product areas, in order, are **分析、错误、性能、事件、API、告警、会话、设置**. “探索” is the advanced filtering mode inside Sessions; “洞察” is reserved for future system-generated findings.
- 分析 owns PV/UV, acquisition, audience dimensions, funnels, paths, retention, and saved analyses.
- 错误 owns error groups, impact, Source Map diagnostics, and the reverse link to affected behavior and sessions.
- 性能 owns Web Vitals, page/route performance, resource timing, distributions, and slow samples.
- 事件 owns the event catalog, event trends, custom properties, raw event samples, and user/session timelines.
- API owns browser request volume, failure rate, latency, normalized endpoints, and request samples.
- 告警 owns product-quality rules, notification state, history, and investigation deep links.
- 洞察 synthesizes meaningful changes across behavior, errors, performance, events, and APIs; every insight must show its evidence and open a filtered investigation rather than present an unexplained score.
- 设置 owns project configuration, SDK keys, data/privacy rules, members, notification channels, appearance, and instance administration. Frequently used settings should remain one click from anywhere.
- 接入、发布与用量 belong to a visually secondary project-management area and never compete with the eight first-level product areas.
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
