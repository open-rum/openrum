# OpenRUM UI foundation

The UI system is built on shadcn/ui (`radix-maia`, Radix primitives, Tailwind
CSS v4) and product-specific semantic tokens. Components are checked into this
directory, so OpenRUM owns their source instead of depending on a black-box UI
package.

Use `npx shadcn@latest add <component>` before creating a new primitive. Keep
product colors and radii in `packages/design-tokens/tokens.css` and map them to shadcn semantic tokens
in `src/styles.css`; do not add component-specific light/dark colors.

## Shape contract

Buttons, single-line inputs, selects, badges, and segmented controls use
`rounded-full`. Multiline fields use `rounded-xl`, cards and menus use
`rounded-2xl`, and dialogs use `rounded-4xl`. Native CSS controls use the matching
`--radius-control`, `--radius-field`, `--radius-surface`, and `--radius-overlay`
tokens. Preserve shared control heights for comfortable and compact density,
line-style navigation tabs, and square joins inside contiguous control groups.

## Readability contract

- Page title: `--text-title` (24px)
- Section title: `--text-section` (16px)
- Product body/navigation: `--text-body` (14px)
- Table/control text: `--text-table` / `--text-control` (12px)
- Supporting metadata: `--text-caption` (11px)
- KPI values: `--text-kpi` (30px)

Text below 11px is not allowed for normal product content. Dense visualizations
may use 10px axis ticks only when labels do not carry the primary meaning.

## Component families

- Controls: `.select-control`, `.icon-button`, `.outline-button`, `.primary-button`
- Navigation: `.nav-item`, `.tab`, `.project-switcher`
- Containers: `.panel`, `.kpi-strip`, `.data-panel`
- Tables: `.data-table`, `.compact-table`, `.rank-list`
- Feedback: `.severity`, shadcn `Sonner` (`toast()` from "sonner", top centre), shadcn `Drawer`

All interactive elements must expose hover/focus states, use the shared control
height tokens, and preserve a minimum 32px pointer target in dense desktop views.

## Themes

- `ThemeProvider` owns `light`, `dark`, and `system` modes.
- The selected mode is persisted under `openrum-theme`.
- `.dark` only changes semantic variables; component selectors stay theme-free.
- Charts, maps, tables, overlays, and future shadcn components consume the same
  variables.
