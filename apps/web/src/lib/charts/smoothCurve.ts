/** Smooth through measured samples without overshooting their local extrema. */
export const smoothCurve = {
  type: "monotoneX",
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;
