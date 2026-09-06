# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

## Active product direction

- The accepted layout target is `../../output/imagegen/openrum-dashboard-stripe.png`.
- Use the Citrus-adapted shadcn theme: neutral white/graphite surfaces, lime primary, teal secondary, compact commercial-reporting density, subtle radii and shadows. Keep red reserved for destructive and error semantics.
- The overview must treat country, device, browser, and custom dimensions/metrics as first-class analysis surfaces.
- Use the typed Go query APIs for implemented product areas; keep deterministic frontend fixtures for unit tests and explicit demo states only.
- Preserve the planned React + TypeScript + Vite stack and the `apps/web` project location.
- Readability outranks maximum density. Product body text starts at 14px, table
  text at 12px, metadata at 11px, and controls at 12px; exceptions require a
  documented reason in the design system.
- Use shadcn/ui (Radix Nova + Tailwind CSS v4) for reusable UI primitives. Keep
  component source local, use semantic tokens, and support light, dark, and
  system appearance without component-level theme colors.
- On desktop, the collapsed sidebar keeps the brand mark above the expand
  control in one centered vertical stack; do not compress them into one row.
- Do not render a separate project-switcher card in the sidebar. The brand link
  remains the route back to the project list and reveals the project switcher
  on hover or keyboard focus.
- The right workspace always has one sticky app status bar. Global utilities
  such as appearance, future language, and notifications live on its right
  edge. Data-analysis routes inject time and environment as optional context;
  offer relative ranges from 5 minutes through 30 days plus an absolute range,
  preserve both values across navigation, and keep page-specific dimensions in
  the page. Keep analysis overview, funnels, paths, and retention as separate
  routes grouped by page-level tabs; refresh remains a page-header action.
- Filled chart marks — areas, bars, scatter points, map and heatmap cells,
  quantity-bearing gradient stops — use `--ds-primary`, not `--ds-brand`. Both
  are citrus, but `--ds-brand` inverts lightness between modes to keep citrus
  _text_ readable, so it renders dark olive on the near-white canvas and only
  looks right in dark mode. In-chart ink (axis and annotation labels, hover
  crosshairs, release markers, bare line strokes with no fill behind them)
  stays on `--ds-brand`, which has the contrast a thin or textual mark needs.
  See `docs/design.md`, "Chart color contract".
- Charts animate by default. Recharts runs its transitions in JavaScript, so the
  global `prefers-reduced-motion` stylesheet cannot reach them; pass
  `isAnimationActive={useChartMotion()}` rather than hard-coding `false`.
- Keep the performance workspace full-width. Present LCP, INP, and CLS as
  separate date-based P75 trend charts because their units and thresholds
  differ; keep Route ranking and the Route table as the drill-down layer below.
- Treat each project card as an operational health summary. Lead with the last
  24 hours of PV, UV, error events, a real PV trend, and reporting freshness;
  keep sampling, retention, role, and other configuration details secondary.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.
