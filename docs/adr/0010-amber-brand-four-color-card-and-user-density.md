# 0010. Amber brand, a four-color card, switchable palettes and user density

Date: 2026-09-29

Status: Accepted

## Context

The Console was locked to a single lemon-green (Citrus) theme, while the home page and docs
had grown their own amber, lime and magenta palettes with separate attributes, storage keys
and overrides. The design workbench only knew Citrus. The user chose amber as the brand and
found that lime, sky and magenta work well beside it as accents for badges and categories.
They also asked for a denser Console layout for people who scan large tables all day.

## Decision

- **Four-color card.** `packages/design-tokens/tokens.css` defines amber, lime, sky and
  magenta, each with `solid`, `foreground`, `soft`, `ink`, `border`, `action` and
  `on-action` roles in light and dark mode. A token test keeps text roles at 4.5:1 or better.
- **Palettes rotate the card.** `html[data-palette]` is `amber` (default), `lime` or
  `magenta`. The chosen hue becomes `--ds-primary` and the logo, the other three become
  `--ds-accent-1..3`, and charts 1–4 follow the same order. Sky is only an accent.
  Charts 5–10, status colors and the neutral period comparison do not change with the
  palette.
- **One attribute, one list.** The Console, home page, docs and design workbench all use
  `data-palette` and the `openrum-palette` storage key. `catalog.ts` lists the palettes;
  the Console account menu and the site's `PaletteMenu` render daisyUI-style dot tiles from
  it and hide themselves when only one palette remains.
- **Neutral actions stay.** Main buttons remain black on white in light mode and white on
  black in dark mode. Brand color marks selection, focus, badges, switches, progress,
  logos and chart series.
- **User density, Console only.** `html[data-density="compact"]`, chosen in the account menu,
  rewrites the control, table, navigation and page-spacing tokens. Metadata stays at 12px
  or larger and coarse pointers keep 44px targets. The public site has no density switch.

## Consequences

- Keeping only amber later means deleting two palette blocks and two catalog entries;
  the switchers then disappear on their own.
- Components must read palette, accent and size tokens instead of fixed hues or pixels,
  or they will not follow the palette or compact density.
- The Console and site are usually on different origins, so a visitor's palette choice is
  remembered separately on each.
