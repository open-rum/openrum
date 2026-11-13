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
- **Surfaces.** The page is `base-200`; the sidebar and the top status bar share `base-100`
  and the same border, framing the page as one L. Cards, panels, menus and dialogs are `base-100` with a
  `base-300` border. daisyUI draws `card-border` in `base-200`, so `styles/daisy.css`
  overrides `card-border` and `card-dash` to `base-300` with `@utility`. Cards are flat; only
  menus, popovers and dialogs keep a shadow.
- **Text contrast.** Secondary text is `base-content` at 85%, muted text at 72%
  (`text-base-content/70` in markup). Do not go lower for readable copy.
- **Semantic text stays readable.** A semantic colour is a fill colour; as text on a white
  card, `warning` is about 1.8:1 and `error` 2.9:1. `styles/daisy.css` therefore mixes it
  toward `base-content` for `btn-soft`, `badge-soft`, `alert-soft`, `text-warning|error|success` and
  `--ds-warning-ink` (with `--ds-danger-ink` and `--ds-success-ink`), and gives inactive tabs
  the muted text token. Dark themes keep the raw colour (`--ds-ink-mix: 100%` under `.dark`).
  Use those, not the raw colour, for text. A danger action is `btn btn-error btn-soft` or a
  `HoldButton`; both draw the same tint and ink, so they must look alike. Run axe
  (`@axe-core/playwright`) after changing a tint.
- **Radius comes from the theme.** `rounded-box` for cards, panels, notes and code blocks,
  `rounded-field` for buttons, inputs, options and icon tiles, `rounded-selector` for badges,
  chips and small tags. In CSS use `var(--radius-box|field|selector)`. Data marks (bars,
  tracks, dots) may stay round or use `min(Npx, var(--radius-selector))` so square themes stay
  square.
- **Spacing.** Page sections use daisyUI `card` padding, 1.5rem (`--card-padding`); cards
  inside a section use `card-sm`, 1rem (`--card-padding-sm`). The shadcn-shaped `Card`
  primitive reads these tokens because daisyUI defines `--card-p` only inside `card-body`.
- **Page frame.** Constrained `ConsolePage` content (`narrow`, `wide`) is horizontally
  centred in the available workspace when no contextual rail is present (user decision,
  2026-11-06). `fluid` fills the workspace; pages with a contextual rail keep their column
  alignment. `ConsolePageHeader` takes a one-line description on list and settings pages;
  detail pages may use breadcrumbs instead.
- **Copy is formal and written for customers** (user decision, 2026-11-09). This applies to
  all Console copy: page descriptions, card notes, legends, hints, empty states, errors and
  alerts. Write plain, formal Chinese that says what the page or control shows and what the
  reader can do. Avoid colloquial phrasing ("最右一根", "用户从哪里来"), slogans and promises
  ("快速定位", "直达证据", "用户旅程"), and step-by-step coaching ("先判断…再…"). Do not write
  notes meant for the developer building the Console: internal terms ("受控维度"),
  implementation details ("服务端逐 API 校验"), or how something was built. Prefer
  "可查看…" or "将显示…" over clipped phrasing, and keep product terms (SDK, DSN, Source Map,
  event names) as they are.
- **Preview data** (user decision, 2026-11-11). In development builds a page may offer
  front-end preview data: `MockDataNotice` (`components/dev`) under the page title, an
  `alert` with a "使用模拟数据" switch, `warning` while preview data shows. The state is
  plain page state (no URL, no storage, gone on reload), shared with nested parts through
  `MockDataContext`, and the page's queries use their own `*-mock` keys and a generator
  next to the page (`features/apis/mockApis.ts`). Nothing renders in production builds.
  The API page is the first; add other pages the same way.
- **No refresh buttons.** Pages do not offer a manual refresh (user decision, 2026-11-05).
  Data follows the time range and filters; status that must stay current polls with
  `refetchInterval` (connection status, instance overview). A retry inside an error state
  (`AsyncError`) is not a refresh button and stays.
- **Status badges are soft.** A state (enabled, healthy, waiting, revoked, failing) uses the
  `Badge` variants `success`, `warning`, `destructive` or `secondary` (neutral), all
  `badge-soft`. `outline` is only for neutral metadata such as environment, release, HTTP
  method or event kind. Do not add a coloured dot inside a badge.
- **Filters look like fields.** A control that holds a filter value (time range, environment,
  dimension) is a daisyUI `select select-sm` field: the `Select` primitive, or a popover
  trigger button with the same `select` classes. Do not use a `btn` for a filter value.
- **Tab counts.** A tab's item count is `TabsCount` (small muted number after the label), not
  `· N` or brackets. A count that needs action, such as pending join requests, is a
  `badge badge-xs badge-primary`. Page-level tabs go in `ConsolePageTabs` (a full-width rule with the active indicator laid on it), outside cards, one
  page gap above the content. They are larger than line tabs inside cards (user request,
  2026-11-09): 15px labels on a 44px row, the selected one semibold with a `primary`
  indicator, the others at 70% `base-content`. The sizes live with `[data-console-page-tabs]`
  in `styles.css`; do not restyle page tabs per page.
- **Card titles have no icons.** Settings, admin and list cards use a plain title and
  description. Icons belong to navigation, empty states, buttons and status rows.
- **Notices are alerts.** A warning about the data on screen (stale feed, unobserved funnel
  step, partial result) is `Alert variant="warning"` (`alert alert-soft alert-warning`) above
  the content it qualifies. The inline freshness line stays muted text.
- **Charts.** Series 1–8 are primary, secondary, accent, info, success, warning, error and
  neutral. Column tops use `useBarRadiusTop()` (`lib/charts/useBarRadius.ts`): the theme's
  `--radius-selector`, capped at 6px. Chart behaviour rules in `apps/web/AGENTS.md` and
  `docs/agents/time-series.md` are unchanged.
- **Chart axes** (user decision, 2026-11-11). Every chart with a value axis spreads
  `valueAxis()` onto its `YAxis` and `timeAxis()` onto its time `XAxis`
  (`lib/charts/axes.tsx`), with `VALUE_AXIS_MARGIN_TOP` as the chart's top margin. Value
  labels sit in their own column beside the plot, level with their gridline (left axis
  right-aligned against the plot, right axis left-aligned), and the unit appears once after
  the top label ("2,000 ms"). The column is as wide as its widest label (`width: "auto"`),
  so no line or area runs under the labels, and never narrower than
  `VALUE_LABEL_MIN_WIDTH`, so charts side by side start their plots at the same place
  whether their figures read "4" or "100". Both axes keep 12px between labels and plot. Labels inside the plot were tried the same day
  and dropped: the chart ran up under its own figures. Time labels stay centred under their
  bucket; only one too close to a plot edge is aligned to that edge. Category axes
  (horizontal bar rankings) keep their outside labels. Do not hand-roll axis widths or
  margins per chart.

## Themes

- `@plugin "daisyui" { themes: all; }` in `src/styles.css` enables every built-in theme.
- `ThemeProvider` stores `openrum-theme`: any daisyUI theme name, `light` by default. The
  Console does not follow the operating system's appearance (user decision, 2026-11-05); a
  stored `system` from before reads as `light`. It writes `<html data-theme>`, toggles `.dark` for the dark themes
  listed in `DARK_DAISY_THEMES`, and `index.html` repeats this before first paint; keep the
  two lists in step.
- The theme switch is `ThemeController`, top-right in the app status bar and on the
  authentication pages: daisyUI's four-dot swatch icon and a menu of every theme.
  The account menu keeps the two quick buttons (light, dark).
- **Custom themes** (user decision, 2026-11-09): there is no theme editor and a saved theme
  never changes. "随机" always shows a random theme as an unsaved preview, whatever is
  selected (`data-theme="custom-preview"`, gone on reload or any theme choice); the menu's
  `HoldButton` "按住添加主题" saves the previewed theme as a new one, or a new random theme
  when nothing is previewed (user correction, 2026-11-10). The action row follows that flow
  (user request, 2026-11-10): "随机配色" then "按住添加", both muted and the same size; while
  a preview shows, a line reads "随机配色 · 未保存" with its swatch, the buttons read "换一个"
  and "按住保存", and only the hold turns `primary`. Themes
  are drawn by daisyUI's generator rules in `components/theme/customThemes.ts` (Tailwind
  palette, no contrast check beyond those rules), named "自定义 N", stored in this browser
  under `openrum-custom-themes` (at most 20), and selected as `data-theme="custom-<id>"`.
  Their dark flag comes from the theme's own `color-scheme`, not `DARK_DAISY_THEMES`.
  `index.html` writes the selected one's rule before first paint; keep it in step with
  `customThemesCss`.
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
| Single-choice switch | `ToggleGroup` (a `base-200` track with a sliding `primary` thumb)     |
| Chart view switch    | `ChartSwitch`: the small segmented `ToggleGroup` (since 2026-11-11)   |
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
