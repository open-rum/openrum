# OpenRUM frontend design system

## Source of truth

The accepted overview concept is `output/imagegen/openrum-dashboard-stripe.png` at
1440 × 1024. It defines the initial frontend shell and overview information
architecture.

## Visual language

- Background: true white (`#ffffff`) with a very faint cool-violet header wash.
- Primary text: near-black navy (`#171829`).
- Muted text: slate (`#6f7287`).
- Rules and borders: warm gray (`#e4e2e8`).
- Accent: elegant violet-blue (`#635bff`), used for active navigation, links,
  chart emphasis, and selected tabs.
- Semantic colors: green `#16a36a`, red `#ef4444`, amber `#f59e0b`.
- Radius: 6–8px; shadows are limited to controls and elevated menus.
- Density: desktop reporting UI with compact 12–14px chrome and readable tables.

## Component foundation

Use shadcn/ui with the Radix Nova preset and Tailwind CSS v4 for reusable
primitives. Component source lives in `apps/web/src/components/ui`; business
surfaces compose those primitives rather than importing a monolithic theme.
The first integrated primitives are Button and Dropdown Menu.

## Color modes

OpenRUM supports light, dark, and system appearance modes. Light mode preserves
the accepted Stripe-inspired white reporting surface. Dark mode uses a neutral
blue-black canvas with the same violet brand accent and semantic status colors.
Theme choice persists locally and is applied before React starts to prevent a
flash of the wrong theme.

## Typography

Use Inter Variable with system sans fallbacks for product text and JetBrains Mono
for endpoints and metric keys. Numbers use tabular variants. Main title is 24px,
section titles 16px, product body 14px, table/control text 12px, and supporting
metadata 11px. Normal product content must not fall below 11px.

## Layout inventory

- 188px hierarchical sidebar with project/environment switcher.
- Breadcrumb and page title row with release and time controls.
- Six equal KPI cells.
- Two-column trend/priority row, approximately 62/38.
- Two-column analytics/custom-data row, approximately 58/42.
- Two-column issue/API table row, approximately 58/42.

## Component families

- App shell, sidebar navigation, project switcher, operator card.
- Select controls, tabs, buttons, status badges, KPI cells.
- Responsive line chart with release marker and custom tooltip.
- Country/device/browser/custom-dimension analysis panel.
- Custom telemetry query builder and channel breakdown.
- Ranked issue list, API health table, compact trend sparklines.

## Core interaction contract

- Release and time-range controls update the visible scope label and chart seed.
- Audience tabs switch between country, device, browser, and custom-dimension views.
- Compare toggles a comparison state with a visible confirmation.
- Custom query fields are editable and “创建自定义查询” adds a saved query notice.
- Issue and API rows are selectable and open a local detail drawer.

## Responsive behavior

At tablet widths the sidebar collapses to an icon rail and the two-column modules
stack. At phone widths navigation becomes a compact top bar; KPI cells scroll
horizontally and tables preserve readable columns through horizontal scrolling.
