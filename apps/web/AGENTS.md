# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

## Active product direction

- The accepted visual target is `../../output/imagegen/openrum-dashboard-stripe.png`.
- Use the Stripe-inspired direction: true white background, warm-gray rules, restrained violet-blue accent, compact commercial-reporting density, subtle radii and shadows.
- The overview must treat country, device, browser, and custom dimensions/metrics as first-class analysis surfaces.
- Frontend data is mocked locally until the Go query API is available.
- Preserve the planned React + TypeScript + Vite stack and the `apps/web` project location.
- Readability outranks maximum density. Product body text starts at 14px, table
  text at 12px, metadata at 11px, and controls at 12px; exceptions require a
  documented reason in the design system.
- Use shadcn/ui (Radix Nova + Tailwind CSS v4) for reusable UI primitives. Keep
  component source local, use semantic tokens, and support light, dark, and
  system appearance without component-level theme colors.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.
