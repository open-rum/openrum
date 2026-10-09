// The category order from docs/design.md ("Chart color contract"): the palette's primary,
// its three accents, then violet, teal, coral, indigo, umber and slate. A colour belongs to a rank —
// a series' configured position or a group's returned rank — never to an array length,
// so adding a series does not repaint the ones already there.
const CATEGORY_SLOTS = 9;

export const OTHER_COLOR = "var(--ds-chart-10)";
export const COMPARISON_STROKE = "var(--ds-chart-comparison)";
export const COMPARISON_DASH = "5 4";

/** Colour for the series or group at a rank. Ranks past nine share "Other". */
export function categoryColor(rank: number): string {
  return rank >= 0 && rank < CATEGORY_SLOTS ? `var(--ds-chart-${rank + 1})` : OTHER_COLOR;
}

/** Colour for a metric with semantic meaning, falling back to its rank. */
export function seriesColor(rank: number, semantic?: string): string {
  if (semantic === "danger") return "var(--ds-danger)";
  if (semantic === "warning") return "var(--ds-warning)";
  return categoryColor(rank);
}
