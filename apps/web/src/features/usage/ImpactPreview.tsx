import type { SamplingImpact } from "./impact";

export function ImpactPreview({ impact }: { impact: SamplingImpact }) {
  const saving = impact.deltaPercent <= 0;
  return (
    <section
      className="rounded-lg border border-border bg-muted/30 p-5"
      aria-labelledby="impact-title"
    >
      <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        保存前预览
      </p>
      <h2 id="impact-title" className="mt-2 text-lg font-semibold">
        预计每日接收 {formatCount(impact.projectedDaily)} 条
      </h2>
      <p
        className={`mt-2 text-sm font-medium ${saving ? "text-(--ds-success)" : "text-(--ds-warning)"}`}
      >
        较当前 {impact.deltaPercent > 0 ? "+" : ""}
        {impact.deltaPercent.toFixed(1)}% · 约 {formatBytes(impact.projectedDailyBytes)}/天
      </p>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-border">
        <div
          className="h-full rounded-full bg-primary"
          style={{
            width: `${Math.min(100, Math.max(2, impact.currentDaily ? (impact.projectedDaily / impact.currentDaily) * 50 : 2))}%`,
          }}
        />
      </div>
      <p className="mt-4 text-xs leading-5 text-muted-foreground">
        基于所选时段的估算原始事件量 × 新采样率计算；错误事件保持
        100%。流量变化和压缩率会让实际结果产生偏差。
      </p>
    </section>
  );
}

function formatCount(value: number) {
  return Math.round(value).toLocaleString("zh-CN");
}

function formatBytes(value: number) {
  if (value < 1024) return `${Math.round(value)} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 ** 2).toFixed(1)} MB`;
}
