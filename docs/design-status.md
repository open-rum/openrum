# Design system status

## Current decision

The design gate is satisfied. `docs/design.md` records the accepted
Stripe-inspired reporting direction, typography scale, responsive behavior,
component foundation, and light/dark/system appearance contract. Product UI
must not introduce new visual values without updating that document first.

## Integration boundary

- `apps/web/src/styles/tokens.css` is the product token source of truth.
- `apps/web/src/styles.css` maps product tokens to shadcn/Tailwind semantic
  variables and contains layout selectors.
- `apps/web/src/components/ui` owns checked-in shadcn primitives. Feature code
  composes these primitives and must not modify generated primitives to add
  feature-specific colors.
- Light and dark themes use the same semantic names. Components must consume
  variables rather than branch on the active theme.
- A theme created at `ui.shadcn.com/create` may be adopted by translating its
  semantic variables at this boundary. Replacing the generated CSS wholesale
  is not allowed because it would bypass OpenRUM's readability and chart-token
  contracts.

## Implemented

- Radix Nova shadcn configuration with Tailwind CSS v4.
- Button and dropdown-menu primitives.
- Persistent light, dark, and system modes with pre-render theme application.
- Shared product typography, color, spacing, radius, control, elevation, and
  motion tokens.
- Semantic chart, map, table, overlay, navigation, and status surfaces.

## Rules for future work

1. Extend `docs/design.md` before adding a new token family or changing the
   accepted visual language.
2. Add tokens to `tokens.css`, then map them in `styles.css`; never place
   customer, project, route, or event values in CSS variable names.
3. Keep normal product text at 11px or larger and dense controls at least 32px
   high.
4. Verify every new surface in light, dark, and system modes, including keyboard
   focus and reduced motion.
5. Run the frontend typecheck and production build after changing tokens or UI
   primitives.
