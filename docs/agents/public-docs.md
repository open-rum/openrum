# Public documentation authoring

## Native components first

The public site uses Astro and Starlight. Prefer their built-in capabilities over
custom HTML, React widgets or CSS reproductions. Keep OpenRUM branding and navigation,
but let Starlight provide the article's component structure and behavior.

- Use MDX when a page needs components. Import from `@astrojs/starlight/components`.
- Use `Steps` around an ordered list for a sequential procedure. Put headings,
  explanations and code inside each list item. Do not manually duplicate step
  numbers in headings or create a custom timeline.
- Use `Aside` for meaningful notes, prerequisites, cautions and destructive-action
  warnings. Do not turn every paragraph or completion marker into a callout.
- Use `CardGrid` and `LinkCard` for entry points and next tasks.
- Use `Tabs` and `TabItem` only for real alternatives, such as supported platforms;
  do not invent unsupported package-manager commands just to populate tabs.
- Use `FileTree` when a directory hierarchy is useful; retain Markdown tables for
  genuine comparisons and reference data.
- Use the built-in Expressive Code renderer: specify a language, give configuration
  snippets their actual filename using `title`, and retain terminal/editor frames
  and copy controls. Do not hide native headers or replace syntax highlighting with
  brand-colored palettes. Brand identity does not require recoloring code tokens.

## Page structure

Split long tutorials by reader task, not arbitrary length. Keep preparation,
installation, first verification and daily operations distinguishable. Group related
pages in Starlight's sidebar with `collapsed: true`; the current page's group should
remain discoverable and expandable. Link prerequisites and the next task explicitly.
Preserve published URLs when splitting a page. Do not put necessary setup steps
inside collapsed content in the article itself.

Keep commands, expected outcomes and failure checks close together. Keep plaintext
commands copyable; copy buttons must not include shell prompts or terminal output.
Use meaningful warning titles and real configuration filenames, not decorative tabs.

## Bilingual changes and validation

Maintain matching English and Simplified Chinese paths and content. Internal Chinese
links use `/zh/docs/`; English links use `/docs/`. Source pages synced from `docs/`
must be edited at their canonical source, not only in the generated output.

For presentation changes, run site content tests and build, then verify both locales,
sidebar expansion, direct child links, language switching, code copying, light/dark
themes and a narrow viewport. Check headings and code readability in rendered pages;
a successful build alone does not prove readable MDX nesting.

After changing Expressive Code configuration, run
`pnpm --filter @openrum/site exec astro build --force` to invalidate cached Markdown
rendering, then check built links and code assets. For theme tests, use Starlight's
theme selector or `starlight-theme` storage key, and assert `html[data-theme]`;
the marketing site's `openrum-theme` preference does not select a docs theme.

Examples: the pages under `apps/site/src/content/docs/docs/getting-started/` and
their Chinese counterparts. Reference: https://starlight.astro.build/components/using-components/.

## Home page

The home page (`apps/site/src/components/landing/`) was redesigned on 2026-09-28 at the
user's request: grand and minimal, with as little copy as possible.

- Five sections only: hero, a six-tab product tour (errors, performance, sessions, logs, alerts, dashboards), architecture and
  performance, FAQ, and "Make it better, together." for contributors. Each section has
  one title, at most one line of subtitle and one visual.
- Dark only. The site shares the whole-product palettes from
  `packages/design-tokens` (amber default, lime, magenta; see ADR 0010). The choice is a
  per-visitor convenience stored in `localStorage` (`openrum-palette`);
  `SitePaletteBootstrap.astro` sets `html[data-palette]` before paint on the home page,
  docs, design workbench and previews. `PaletteMenu.astro` is the one switcher: a
  daisyUI-style tile of the primary plus three accents, in the home header, the docs
  header and the design workbench. The home page's `--lp-*` tokens read the palette
  tokens; docs keep both light and dark themes in every palette. The favicon is
  static amber. At 420px the home header drops its GitHub icon and at 360px its
  wordmark so the palette menu and call to action still fit.
- Product visuals are schematic mocks (`ProductMock.astro`) until real Console
  screenshots replace them.
- Performance numbers come from `docs/benchmarks/local-capacity-2026-09-18.md` and must
  keep their footnote: a synthetic single-machine run, not a production certification.
