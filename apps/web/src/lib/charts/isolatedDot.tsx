import type { TimeSeriesRow } from "./timeSeries";

/** Show a marker only when a real sample has no neighboring segment. */
export function isolatedDot(
  data: { rows: TimeSeriesRow[] },
  key: string,
  color: string,
  radius = 2.5,
) {
  return ({ cx, cy, index = -1 }: { cx?: number; cy?: number; index?: number }) => {
    const valid = (at: number) => {
      const value = data.rows[at]?.[key];
      return typeof value === "number" && Number.isFinite(value);
    };
    return valid(index) && !valid(index - 1) && !valid(index + 1) ? (
      <circle className="dashboard-isolated-dot" cx={cx} cy={cy} r={radius} fill={color} />
    ) : (
      <></>
    );
  };
}
