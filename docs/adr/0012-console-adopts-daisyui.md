# 0012. The Console adopts daisyUI

Date: 2026-11-03

Status: Accepted. Supersedes the Console parts of
[ADR 0010](0010-amber-brand-four-color-card-and-user-density.md).

## Context

The Console was styled with shadcn/ui on the Radix Maia preset, the amber four-colour card
(amber, lime or magenta as a selectable primary) and a comfortable/compact density setting
(ADR 0010). Each primitive carried long hand-written class strings, page CSS used product
tokens, and the shape rules (pill buttons and inputs) were our own. On 2026-10-30 the product
owner tried daisyUI on two pages, then asked for every Console component to follow daisyUI's
conventions and for the theme choice to offer daisyUI's built-in themes. On 2026-11-03 they
decided to keep it for the Console only.

## Decision

- **daisyUI 5 for the Console.** `apps/web` loads `@plugin "daisyui" { themes: all; }`.
  Components use daisyUI classes and colour names; Radix primitives keep their behaviour with
  daisyUI-styled class strings. The rules live in `docs/agents/console-ui.md`.
- **Themes, not palettes.** The theme is any built-in daisyUI theme or `system` (daisyUI light
  or dark by the OS), stored as `openrum-theme` and written to `<html data-theme>` before
  first paint. A top-right theme switch shows daisyUI's swatch icon. The amber/lime/magenta
  palettes and compact density are removed from the Console.
- **Existing CSS follows the theme.** `styles/daisy.css` maps every `--ds-*` token and shadcn
  variable to the active theme's variables, so page CSS and charts change with it. New code
  uses daisyUI classes directly.
- **Two Console adjustments to daisyUI defaults.** The page is `base-200` and bordered cards
  use `base-300` (daisyUI's `base-200` card border would vanish on that page); secondary and
  muted text stay at 85% and 72% of `base-content` for contrast.
- **Site and docs unchanged.** `apps/site`, the public docs, `packages/design-tokens` and
  `docs/design.md` keep the amber brand and their own components.

## Consequences

- People pick from 35 themes instead of three palettes, and no longer have a compact layout.
  Brand amber now survives only in the logo's favicon and on the public site.
- Shape and colour come from the theme, so square themes give square controls and charts; a
  layout must not depend on a particular radius.
- The Console and the public site no longer share a visual language. Shared packages
  (`@openrum/ui` chart helpers, `@openrum/design-tokens`) stay usable by both, but Console
  code must not reach for the site's palette tokens.
- Contributors follow daisyUI's documentation; the project ships its agent skill in
  `.claude/skills/daisyui`.
