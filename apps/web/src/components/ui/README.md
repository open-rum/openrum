# OpenRUM Console UI foundation

The Console is styled with daisyUI 5 on Tailwind CSS v4 (ADR 0012). The rules are in
`docs/agents/console-ui.md`; load the `daisyui` skill before writing markup.

Components in this directory keep the shadcn file layout and Radix behaviour (dialogs,
sheets, selects, menus, popovers, tooltips, checkboxes, switches), but their classes are
daisyUI's: `Button` is `btn`, `Badge` is `badge`, `Card` is `card card-border`, `Input` is
`input`, `Select` is `select`, `Tabs` are `tabs-box` / `tabs-border`, `ToggleGroup` is a
track with a sliding thumb, `Checkbox` and `Switch` are `checkbox` and `toggle`, `Table` is `table`, `Alert` is
`alert`, `Skeleton` is `skeleton` and `Progress` is `progress`. daisyUI-only helpers live in
`components/daisy` (`DaisyDropdown`, `DaisyModal`, `ThemeSwatch`).

## Shape and colour

- Radius comes from the active theme: `rounded-box` (cards, menus, dialogs),
  `rounded-field` (buttons, inputs, options), `rounded-selector` (badges, chips).
- Colours are daisyUI names (`base-100/200/300`, `base-content`, `primary`…`error`). Never
  combine `dark:` with them and never colour text with a fixed Tailwind palette colour.
- Cards pad with `--card-padding` (1.5rem) or, at `size="sm"`, `--card-padding-sm` (1rem).

## Themes

- `ThemeProvider` stores any daisyUI theme (default `light`) under `openrum-theme` and writes
  `<html data-theme>`; dark themes also set `.dark`.
- `styles/daisy.css` points the older `--ds-*` and shadcn variables at the active theme so
  page CSS and charts follow it. New code uses daisyUI classes rather than those aliases.
