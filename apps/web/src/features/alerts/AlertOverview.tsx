import type { AlertOverview as Overview, RuleAttention } from "./alertPresentation";

const reasonLabels: Record<RuleAttention, string> = {
  breached: "超过阈值",
  delivery_failed: "送达失败",
  eval_failed: "评估失败",
  no_channel: "没有可用渠道",
};

function names(items: string[]) {
  if (items.length <= 2) return items.join("、");
  return `${items.slice(0, 2).join("、")} 等 ${items.length} 条`;
}

/** Four numbers that say where to look first; each opens the matching rules or records. */
export function AlertOverview({
  overview,
  onShowBreached,
  onShowTriggers,
  onShowFailures,
  onShowAttention,
}: {
  overview: Overview;
  onShowBreached: () => void;
  onShowTriggers: () => void;
  onShowFailures: () => void;
  onShowAttention: () => void;
}) {
  const delta =
    overview.previousTriggers === null ? null : overview.triggers - overview.previousTriggers;
  const reasonCounts = new Map<RuleAttention, number>();
  for (const item of overview.needAction)
    reasonCounts.set(item.reason, (reasonCounts.get(item.reason) ?? 0) + 1);
  return (
    <section
      aria-label="告警总览"
      className="stats stats-vertical card card-border w-full bg-base-100 sm:stats-horizontal"
    >
      <button
        type="button"
        className="stat items-start text-left hover:bg-base-200/50"
        onClick={onShowBreached}
      >
        <span className="stat-title">正在超阈值</span>
        <span className={`stat-value text-2xl ${overview.breaching.length ? "text-error" : ""}`}>
          {overview.breaching.length}
          <span className="ml-1 text-sm font-normal text-base-content/70">条规则</span>
        </span>
        <span className="stat-desc whitespace-normal">
          {overview.breaching.length
            ? names(overview.breaching.map((rule) => rule.name))
            : "没有规则超过阈值"}
        </span>
      </button>
      <button
        type="button"
        className="stat items-start text-left hover:bg-base-200/50"
        onClick={onShowTriggers}
      >
        <span className="stat-title">近 24 小时触发</span>
        <span className="stat-value text-2xl">
          {overview.triggers}
          {overview.triggersTruncated ? "+" : ""}
          <span className="ml-1 text-sm font-normal text-base-content/70">次</span>
        </span>
        <span className="stat-desc whitespace-normal">
          {delta === null || overview.triggersTruncated
            ? "仅统计已加载的最近记录"
            : delta === 0
              ? "与前 24 小时持平"
              : `比前 24 小时${delta > 0 ? "多" : "少"} ${Math.abs(delta)} 次`}
        </span>
      </button>
      <button
        type="button"
        className="stat items-start text-left hover:bg-base-200/50"
        onClick={onShowFailures}
      >
        <span className="stat-title">送达失败</span>
        <span className={`stat-value text-2xl ${overview.deliveryFailures ? "text-warning" : ""}`}>
          {overview.deliveryFailures}
          <span className="ml-1 text-sm font-normal text-base-content/70">次</span>
        </span>
        <span className="stat-desc whitespace-normal">
          {overview.deliveryFailures
            ? names(overview.failedRuleNames)
            : overview.triggers
              ? "近 24 小时的触发都已送达或无需外发"
              : "近 24 小时没有触发"}
        </span>
      </button>
      <button
        type="button"
        className="stat items-start text-left hover:bg-base-200/50"
        onClick={onShowAttention}
      >
        <span className="stat-title">需要处理的规则</span>
        <span className={`stat-value text-2xl ${overview.needAction.length ? "text-warning" : ""}`}>
          {overview.needAction.length}
          <span className="ml-1 text-sm font-normal text-base-content/70">条规则</span>
        </span>
        <span className="stat-desc whitespace-normal">
          {overview.needAction.length
            ? [...reasonCounts]
                .map(([reason, count]) => `${count} 条${reasonLabels[reason]}`)
                .join(" · ")
            : "没有需要处理的配置"}
        </span>
      </button>
    </section>
  );
}
