# Phase 9 review — public website and documentation

Date: 2026-09-04

## Outcome

TASK-095 through TASK-105 are implemented. The authenticated Console remains independent from a static Astro/Starlight public surface with Landing, Product, Self-host, Community, Benchmarks and `/docs` routes. English and core Simplified Chinese paths, local Pagefind search, shared Citrus semantic tokens, light/dark themes and Quickstart/GitHub adoption paths are present.

SDK and Source Map examples were checked against exported source APIs. Configuration, Event schema and Helm values references are generated from repository sources with drift checks. Existing repository guides are copied into hidden generated routes during the build so they retain one canonical source.

## Verification

- `pnpm dlx shadcn@latest info --json` reports Astro, Radix Nova/Radix, Tailwind v4 and Lucide with resolved `src` aliases.
- `pnpm run docs:check` passes for all three generated references.
- `pnpm run design:check` enforces that application sources contain no raw color literals outside the shared design-token package.
- `pnpm run site:spell` checks the public content and canonical repository documentation with CSpell.
- `pnpm run site:verify-demo` verifies the fixed seed, deterministic IDs, reset guide and mapped investigation path.
- `pnpm site:build` builds 45 static pages and a local Pagefind index.
- `node scripts/site/check-built-links.mjs` checks all built HTML routes, fragments, unique canonicals, Release/commit markers and the inbound page graph.
- `node scripts/site/check-performance-budget.mjs` passes with no external scripts.
- `node scripts/site/check-lighthouse.mjs` passes the four acceptance pages at ≥90 for Performance, Accessibility and SEO; the measured local mobile runs had 100 Performance/SEO, 92–96 Accessibility, 1.05–1.51s LCP, zero CLS and zero total blocking time.
- `pnpm run site:test:e2e` passes six Chromium checks covering metadata, canonical links, critical axe findings, theme persistence, equivalent language navigation and local search.
- `pnpm run test:e2e` passes all 29 Console journeys, including the updated Session → Issue path, shadcn Drawer interaction and recent password confirmation before retention mutation.
- `pnpm run check` passes formatting, lint/vet, type checks, unit tests, generated protocol, builds and bundle budgets.
- Both the complete OpenRUM image and the non-root public-site nginx image build; the site container returns readiness and the expected short-HTML/immutable-asset cache headers.
- The refreshed local Compose stack reports all nine services healthy, and the Console returns HTTP 200 on `http://127.0.0.1:4173/`.
- Browser SDK, React example, public site and Console type checks pass.

The Starlight build emits one non-fatal route-priority warning because the intentionally supplied `404` content entry is consumed by Starlight's dedicated `/404` route. The resulting page is generated and link-checked.

## Remaining external gates

TASK-106 remains open even though the preview artifact workflow, production GHCR image workflow, cache policy and deployment runbook exist. Completion requires a real public repository/license decision, DNS/TLS for `openrum.dev`, the configured GitHub `public-site` Environment and an external tester completing the documented journey. TASK-076 likewise requires the controlled pilot owner sign-off. This review does not fabricate either result.
