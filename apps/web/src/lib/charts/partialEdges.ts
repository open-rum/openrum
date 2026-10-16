import { PARTIAL_SUFFIX, type PlotData, type SeriesDefinition } from "./plotData";
import { intervalLabel, partialBucketEdges } from "./timeSeries";

type Rows = PlotData["rows"];

/**
 * Moves the buckets that have not run their whole interval onto dashed "partial" series: the
 * one still open at the right edge, or one clipped by the range start. Such a bucket holds
 * fewer events than a whole one would, so a solid line into it draws a fall that did not
 * happen. Only a bucket that has data counts; an empty one at the edge is just a gap. The
 * dashed stretch starts at the last whole point so the line stays connected.
 */
export function withPartialEdges({
  rows,
  keys,
  series,
  from,
  to,
  seconds,
}: {
  rows: Rows;
  /** The line series that can be partial, by key. */
  keys: string[];
  series: SeriesDefinition[];
  from: string;
  to: string;
  seconds: number;
}): { rows: Rows; series: SeriesDefinition[]; edgeNote?: string } {
  const edges = partialBucketEdges(
    rows.map((row) => Date.parse(String(row.label))),
    seconds,
    Date.parse(from),
    Date.parse(to),
  );
  const hasData = (index: number) => keys.some((key) => rows[index]?.[key] !== null);
  const last = rows.length - 1;
  const partial = new Set<number>();
  if (edges.first && hasData(0)) partial.add(0);
  if (edges.last && last > 0 && hasData(last)) partial.add(last);
  if (!partial.size) return { rows, series };

  const joints = new Set<number>();
  if (partial.has(0) && rows.length > 1) joints.add(1);
  if (partial.has(last)) joints.add(last - 1);

  const plotted = rows.map((row, index) => {
    const isPartial = partial.has(index);
    const dashed = isPartial || joints.has(index);
    const next: Rows[number] = { ...row };
    for (const key of keys) {
      next[key] = isPartial ? null : row[key];
      next[`${key}${PARTIAL_SUFFIX}`] = dashed ? row[key] : null;
    }
    return next;
  });
  const extra = keys.flatMap((key) => {
    const base = series.find((item) => item.key === key);
    return base
      ? [
          {
            ...base,
            key: `${key}${PARTIAL_SUFFIX}`,
            label: `${base.label}（未满周期）`,
            role: "partial" as const,
          },
        ]
      : [];
  });
  return {
    rows: plotted,
    series: [...series, ...extra],
    edgeNote: `虚线是未满一个周期（${intervalLabel(seconds)}）的数据，偏低不代表流量下降`,
  };
}
