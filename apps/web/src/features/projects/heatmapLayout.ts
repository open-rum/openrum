const DAY_MS = 24 * 60 * 60 * 1000;

export type HeatmapLevel = 0 | 1 | 2 | 3 | 4;

export type HeatmapCell = {
  /** UTC midnight that starts the day. */
  date: Date;
  /** Page views, or null when the server returned no bucket for the day. */
  value: number | null;
  level: HeatmapLevel | null;
  /** Today's bucket is still filling. */
  partial: boolean;
};

export type Heatmap = {
  cells: HeatmapCell[];
  /** Columns of seven slots, Monday first; slots outside the range are null. */
  weeks: Array<Array<HeatmapCell | null>>;
  /** A month label for the first column of each month, keyed by column index. */
  monthLabels: Map<number, string>;
  total: number;
  activeDays: number;
  peak: HeatmapCell | null;
  hasData: boolean;
};

type Range = { from: string; to: string; intervalSeconds: number };
type Point = { bucket: string; value: number | null };

/**
 * Lays one project's daily page views out like a code-contribution calendar. It only
 * accepts daily buckets: the backend picks the interval, and re-bucketing counts here
 * would contradict the time-series policy. Missing days stay null rather than 0.
 */
export function buildHeatmap(range: Range, points: Point[]): Heatmap | null {
  if (range.intervalSeconds !== DAY_MS / 1000) return null;
  const start = Math.floor(Date.parse(range.from) / DAY_MS) * DAY_MS;
  const end = Date.parse(range.to);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;

  const byDay = new Map(points.map((point) => [Date.parse(point.bucket), point.value]));
  const cells: HeatmapCell[] = [];
  for (let at = start; at < end; at += DAY_MS) {
    const value = byDay.get(at);
    cells.push({
      date: new Date(at),
      value: typeof value === "number" && Number.isFinite(value) ? value : null,
      level: null,
      partial: at + DAY_MS > end,
    });
  }

  const known = cells.filter((cell) => cell.value !== null);
  const max = Math.max(0, ...known.map((cell) => cell.value ?? 0));
  for (const cell of cells) cell.level = levelFor(cell.value, max);

  const peak = max > 0 ? (cells.find((cell) => cell.value === max) ?? null) : null;

  const weeks: Array<Array<HeatmapCell | null>> = [];
  const lead = weekday(cells[0]?.date ?? new Date(start));
  let column: Array<HeatmapCell | null> = Array.from({ length: lead }, () => null);
  for (const cell of cells) {
    column.push(cell);
    if (column.length === 7) {
      weeks.push(column);
      column = [];
    }
  }
  if (column.length)
    weeks.push([...column, ...Array.from({ length: 7 - column.length }, () => null)]);

  const monthLabels = new Map<number, string>();
  let previousMonth = -1;
  weeks.forEach((week, index) => {
    const first = week.find((cell) => cell !== null);
    if (!first) return;
    const month = first.date.getUTCMonth();
    if (month !== previousMonth) monthLabels.set(index, `${month + 1}月`);
    previousMonth = month;
  });

  return {
    cells,
    weeks,
    monthLabels,
    total: known.reduce((sum, cell) => sum + (cell.value ?? 0), 0),
    activeDays: known.filter((cell) => (cell.value ?? 0) > 0).length,
    peak,
    hasData: known.length > 0,
  };
}

/** Quarter steps of the project's own peak, so one busy project never washes out another. */
export function levelFor(value: number | null, max: number): HeatmapLevel | null {
  if (value === null) return null;
  if (value <= 0 || max <= 0) return 0;
  const ratio = value / max;
  if (ratio <= 0.25) return 1;
  if (ratio <= 0.5) return 2;
  if (ratio <= 0.75) return 3;
  return 4;
}

/** Monday is 0, matching the Chinese week. */
export function weekday(date: Date) {
  return (date.getUTCDay() + 6) % 7;
}

export function formatDay(date: Date) {
  return `${date.getUTCMonth() + 1}月${date.getUTCDate()}日`;
}
