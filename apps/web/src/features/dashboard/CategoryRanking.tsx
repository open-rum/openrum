import { countryLabel, deviceLabel } from "@/features/filters/dimensionLabels";
import { SessionClientMeta } from "@/features/sessions/SessionClientMeta";
import { useChartMotion } from "@/lib/charts/useChartMotion";
import { formatDetailedMetric, type PlotData } from "./adapters";
import { donutShare } from "./donutData";

export function CategoryRanking({
  data,
  title,
  detailed = false,
}: {
  data: PlotData;
  title: string;
  detailed?: boolean;
}) {
  const animate = useChartMotion();
  const series = data.series[0];
  if (!series) return null;
  const dimension = data.distribution?.dimension;
  const rows = data.rows
    .map((row, index) => {
      const raw = row[series.key];
      return {
        id: index,
        name: String(row.label || "未知"),
        value: typeof raw === "number" && Number.isFinite(raw) && raw >= 0 ? raw : null,
      };
    })
    .sort((a, b) => (b.value ?? -1) - (a.value ?? -1));
  const total = rows.reduce((sum, row) => sum + (row.value ?? 0), 0);
  const maximum = rows[0]?.value ?? 0;
  const sharesAvailable = total > 0 && rows.every((row) => row.value !== null);
  const visible = detailed ? rows : rows.slice(0, 10);
  const dimensionName =
    dimension === "country"
      ? "国家 / 地区"
      : dimension === "browser"
        ? "浏览器"
        : dimension === "device"
          ? "设备"
          : dimension === "source"
            ? "来源"
            : "分类";

  return (
    <div className="dashboard-ranking" data-category-ranking data-animate={animate || undefined}>
      <div className="dashboard-ranking-heading" aria-hidden="true">
        <span>{dimensionName}</span>
        <span>{series.label}</span>
        <span>占比</span>
      </div>
      <ol
        className="dashboard-ranking-list"
        aria-label={`${title} 分类排行`}
        tabIndex={visible.length > 4 ? 0 : undefined}
      >
        {visible.map((row, index) => {
          const label =
            dimension === "country"
              ? countryLabel(row.name)
              : dimension === "device"
                ? deviceLabel(row.name)
                : row.name;
          const share = sharesAvailable && row.value !== null ? donutShare(row.value / total) : "—";
          return (
            <li key={`${row.name}-${row.id}`} className="dashboard-ranking-row">
              <div className="dashboard-ranking-values">
                <div className="dashboard-ranking-name">
                  <span className="dashboard-ranking-position" aria-hidden="true">
                    {index + 1}
                  </span>
                  {dimension === "browser" || dimension === "country" || dimension === "device" ? (
                    <span className="shrink-0" aria-hidden="true">
                      <SessionClientMeta
                        browser={dimension === "browser" ? row.name : undefined}
                        country={dimension === "country" ? row.name : undefined}
                        deviceType={dimension === "device" ? row.name : undefined}
                      />
                    </span>
                  ) : null}
                  <span className="min-w-0 [overflow-wrap:anywhere]">{label}</span>
                </div>
                <span className="dashboard-ranking-value">
                  <span className="sr-only">{series.label}：</span>
                  {formatDetailedMetric(row.value, series.unit)}
                </span>
                <span className="dashboard-ranking-share">
                  <span className="sr-only">占比：</span>
                  {share}
                </span>
              </div>
              <div className="dashboard-ranking-track" aria-hidden="true">
                <span
                  className="dashboard-ranking-fill"
                  style={{
                    background: series.color,
                    transform: `scaleX(${maximum > 0 && row.value !== null ? row.value / maximum : 0})`,
                  }}
                />
              </div>
            </li>
          );
        })}
      </ol>
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        {visible.length < rows.length
          ? `前 ${visible.length} / ${rows.length} 项 · 在「详细」中查看全部。`
          : ""}
        占比按已返回分组合计计算，条形按最大值比较。
        {data.distribution?.nonAdditive ? " 用户 / 会话可能跨分组重复。" : ""}
        {!sharesAvailable && total > 0 ? " 部分数据缺失，暂不计算占比。" : ""}
        {data.distribution?.limitReached
          ? ` 已达 ${data.distribution.rowLimit} 组查询上限，分布可能不完整。`
          : ""}
      </p>
    </div>
  );
}
