# Console UI: daisyUI

Read this file before changing any Console (`apps/web`) component, page style, theme, colour,
radius, spacing or chart colour. The Console runs on daisyUI 5 (user decision, 2026-11-03).
The public site and documentation (`apps/site`) keep their own design system in
`docs/design.md` and `packages/design-tokens`; nothing here applies to them.

The project ships daisyUI's own agent skill in `.claude/skills/daisyui`. Load it (the `daisyui`
skill) and read the guides for the components you use before writing Console markup.

## Stable rules

- **Use daisyUI classes first.** Add the component class, then its parts and modifiers
  (`btn btn-sm`, `card card-border`, `menu menu-sm`, `badge badge-soft badge-success`). Reach
  for Tailwind utilities only for what daisyUI does not cover, and write custom CSS only for
  layout no utility expresses. Do not add new shadcn-style class strings.
- **Default variants.** A plain `btn` is the normal action. `btn-primary` is the page's main
  action, once per view. Destructive actions use `btn-error` (soft in menus and rows).
- **Colours are daisyUI names.** Use `base-100/200/300`, `base-content` and the semantic
  colours (`primary`, `secondary`, `accent`, `neutral`, `info`, `success`, `warning`,
  `error`). Never combine `dark:` with a daisyUI colour, and never colour text with a fixed
  Tailwind palette colour (`text-slate-*`, `text-white`): it becomes unreadable in some
  themes. The exceptions are brand marks that must not change (Google's G, the
  `--ds-channel-*` notification tiles).
- **Surfaces.** The page is `base-200`; cards, panels, menus and dialogs are `base-100` with a
  `base-300` border. daisyUI draws `card-border` in `base-200`, so `styles/daisy.css`
  overrides `card-border` and `card-dash` to `base-300` with `@utility`. Cards are flat; only
  menus, popovers and dialogs keep a shadow.
- **Text contrast.** Secondary text is `base-content` at 85%, muted text at 72%
  (`text-base-content/70` in markup). Do not go lower for readable copy.
- **Radius comes from the theme.** `rounded-box` for cards, panels, notes and code blocks,
  `rounded-field` for buttons, inputs, options and icon tiles, `rounded-selector` for badges,
  chips and small tags. In CSS use `var(--radius-box|field|selector)`. Data marks (bars,
  tracks, dots) may stay round or use `min(Npx, var(--radius-selector))` so square themes stay
  square.
- **Spacing.** Page sections use daisyUI `card` padding, 1.5rem (`--card-padding`); cards
  inside a section use `card-sm`, 1rem (`--card-padding-sm`). The shadcn-shaped `Card`
  primitive reads these tokens because daisyUI defines `--card-p` only inside `card-body`.
- **Charts.** Series 1–8 are primary, secondary, accent, info, success, warning, error and
  neutral. Column tops use `useBarRadiusTop()` (`lib/charts/useBarRadius.ts`): the theme's
  `--radius-selector`, capped at 6px. Chart behaviour rules in `apps/web/AGENTS.md` and
  `docs/agents/time-series.md` are unchanged.

## Themes

- `@plugin "daisyui" { themes: all; }` in `src/styles.css` enables every built-in theme.
- `ThemeProvider` stores `openrum-theme`: `system` (daisyUI `light` or `dark` by the OS) or
  any daisyUI theme name. It writes `<html data-theme>`, toggles `.dark` for the dark themes
  listed in `DARK_DAISY_THEMES`, and `index.html` repeats this before first paint; keep the
  two lists in step.
- The theme switch is `ThemeController`, top-right in the app status bar and on the
  authentication pages: daisyUI's four-dot swatch icon and a menu of every theme plus 跟随系统.
  The account menu keeps the three quick buttons (system, light, dark).
- The amber/lime/magenta palettes and compact density were removed from the Console. Do not
  reintroduce `data-palette`, `data-density` or a density setting.

## How the old system maps

`src/styles/daisy.css` points every `--ds-*` token and every shadcn variable (`--background`,
`--card`, `--primary`, `--muted`, …) at the active daisyUI theme, so existing page CSS and
charts follow it. Prefer daisyUI classes in new code rather than these aliases.

| Need                 | Use                                                                   |
| -------------------- | --------------------------------------------------------------------- |
| Button, icon button  | `Button` primitive (`btn`, `btn-square`) or `btn` directly            |
| Status, category     | `Badge` primitive (`badge`), `status` for a dot                       |
| Card, section        | `Card` primitive or `card card-border bg-base-100`                    |
| Metric group         | `stats` / `stat`                                                      |
| Single-choice switch | `ToggleGroup` (renders a `join` of `btn`s)                            |
| Chart view switch    | `ChartSwitch` (`tabs tabs-box tabs-xs`); never a primary-filled join  |
| Tabs                 | `Tabs` primitive (`tabs-box`, `tabs-border`)                          |
| List of rows         | `list` / `list-row`; tabular data uses `table`                        |
| Disclosure           | `collapse collapse-arrow` on `<details>`; layout goes in an inner div |
| Menu from a trigger  | `DaisyDropdown` (popover + anchor) or the Radix `DropdownMenu`        |
| Confirmation         | `DaisyModal` (native `<dialog class="modal">`)                        |
| Notice               | `alert alert-soft alert-{info,success,warning,error}`                 |
| Date range           | `RangeCalendar` (DayPicker with `react-day-picker` styles)            |

Radix primitives stay where they own behaviour (dialogs, sheets, selects, dropdown menus,
popovers, tooltips, hover cards); their class strings are daisyUI-styled.

## Change map

| Concern                          | Files                                                                     |
| -------------------------------- | ------------------------------------------------------------------------- |
| Plugin, theme mapping, overrides | `apps/web/src/styles.css`, `apps/web/src/styles/daisy.css`                |
| Theme state and pre-paint        | `apps/web/src/components/theme/ThemeProvider.tsx`, `apps/web/index.html`  |
| Theme switch                     | `apps/web/src/components/theme/ThemeController.tsx`, `components/daisy/*` |
| Primitives                       | `apps/web/src/components/ui/*`                                            |
| Column radius                    | `apps/web/src/lib/charts/useBarRadius.ts`                                 |
