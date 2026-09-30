import { formatDay, type Heatmap, type HeatmapCell } from "./heatmapLayout";

const count = new Intl.NumberFormat("zh-CN");
const compact = new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 });
const weekdayLabels = ["一", "二", "三", "四", "五", "六", "日"];

/**
 * A calendar heatmap of daily page views: weekdays run across the full card width and
 * each row is one week, so thirty days fill the card instead of a narrow strip. The whole figure is one image
 * with a spoken summary; each square keeps its exact day and value as a hover title.
 */
export function ActivityHeatmap({ heatmap }: { heatmap: Heatmap }) {
  const { weeks, monthLabels, cells, activeDays, total, peak } = heatmap;
  const summary = [
    `近 ${cells.length} 天 PV：活跃 ${activeDays} 天`,
    `合计 ${compact.format(total)}`,
    peak ? `峰值 ${formatDay(peak.date)} ${compact.format(peak.value ?? 0)}` : null,
  ]
    .filter(Boolean)
    .join("，");

  return (
    <figure className="activity-heatmap" role="img" aria-label={summary}>
      <div className="activity-heatmap__grid" aria-hidden="true">
        <span />
        {weekdayLabels.map((label) => (
          <span key={label} className="activity-heatmap__weekday">
            {label}
          </span>
        ))}
        {weeks.map((week, row) => [
          <span key={`month-${row}`} className="activity-heatmap__month">
            {monthLabels.get(row) ?? ""}
          </span>,
          ...week.map((cell, column) =>
            cell ? (
              <span
                key={`${row}-${column}`}
                className="activity-heatmap__cell"
                data-level={cell.level ?? "none"}
                title={cellTitle(cell)}
              />
            ) : (
              <span key={`${row}-${column}`} className="activity-heatmap__slot" />
            ),
          ),
        ])}
      </div>
      <figcaption className="activity-heatmap__legend" aria-hidden="true">
        <span>按 UTC 自然日</span>
        <span className="activity-heatmap__scale">
          少
          {[0, 1, 2, 3, 4].map((level) => (
            <span key={level} className="activity-heatmap__cell" data-level={level} />
          ))}
          多
        </span>
      </figcaption>
    </figure>
  );
}

function cellTitle(cell: HeatmapCell) {
  const day = `${formatDay(cell.date)}${cell.partial ? "（今天，未满一天）" : ""}`;
  return cell.value === null ? `${day} · 无数据` : `${day} · PV ${count.format(cell.value)}`;
}
