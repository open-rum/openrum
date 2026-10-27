import { useState } from "react";
import { ListTreeIcon, TriangleAlertIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatRelative } from "@/features/analytics/format";
import { eventLabel } from "@/features/analytics/labels";
import type {
  BehaviorAnalyticsResponse,
  BehaviorDimension,
  BehaviorFilters,
  BehaviorKind,
} from "@/lib/api/analytics";
import { kindLabel } from "./catalog";
import { EventDetailDrawer } from "./EventDetailDrawer";
import { EventList } from "./EventList";
import { EventSummary } from "./EventSummary";

/**
 * The Events page body: four summary views in one row, then the list of events. An event
 * opens in a drawer; the filters in the page's search bar decide what the summary shows.
 */
export function EventExplorer({
  data,
  filters,
  isFetching = false,
  onSelectEvent,
  onChangeDimension,
}: {
  data: BehaviorAnalyticsResponse;
  filters: BehaviorFilters;
  /** True while a refetch is in flight; the previous figures stay on screen, dimmed. */
  isFetching?: boolean;
  /** Pass nothing to clear the event filter, or only a kind to filter by type. */
  onSelectEvent: (kind?: BehaviorKind, name?: string) => void;
  onChangeDimension: (dimension: BehaviorDimension) => void;
}) {
  const [open, setOpen] = useState<{ kind: BehaviorKind; name: string }>();
  if (!data.catalog.length && data.totals.events === 0) {
    return <NoEvents projectId={filters.projectId} />;
  }
  return (
    <div className="event-explorer" data-fetching={isFetching || undefined}>
      <EventContextBar
        filters={filters}
        freshness={data.freshness}
        isFetching={isFetching}
        onClear={() => onSelectEvent()}
      />
      <EventSummary
        data={data}
        dimension={filters.dimension}
        onChangeDimension={onChangeDimension}
        onSelectKind={(kind) => onSelectEvent(kind)}
      />
      <EventList
        catalog={data.catalog}
        // The catalog ignores the selected event and the search, so its shares are of its own
        // sum; the page's totals may describe a narrowed slice.
        total={data.catalog.reduce((sum, entry) => sum + entry.metric.events, 0)}
        selectedKind={filters.eventKind}
        selectedName={filters.eventName}
        onOpen={(kind, name) => setOpen({ kind, name })}
      />
      {open ? (
        // Keyed so a different event starts with its own distribution and samples.
        <EventDetailDrawer
          key={`${open.kind}:${open.name}`}
          filters={filters}
          kind={open.kind}
          name={open.name}
          onClose={() => setOpen(undefined)}
        />
      ) : null}
    </div>
  );
}

/**
 * What the summary is showing and how old it is. A selected event or type is named here,
 * beside the figures it drives; a stale feed gets a visible notice because the numbers
 * below are then not the latest.
 */
function EventContextBar({
  filters,
  freshness,
  isFetching,
  onClear,
}: {
  filters: BehaviorFilters;
  freshness: BehaviorAnalyticsResponse["freshness"];
  isFetching: boolean;
  onClear: () => void;
}) {
  const selected = Boolean(filters.eventKind || filters.eventName);
  const age = freshness.latestReceivedAt
    ? `数据更新于 ${formatRelative(freshness.ageSeconds)}`
    : "暂无新鲜度信息";
  return (
    <div className="event-context">
      <div className="event-context__selection">
        {selected ? (
          <>
            <span>正在查看</span>
            <strong>
              {filters.eventName
                ? eventLabel(filters.eventKind ?? "custom", filters.eventName)
                : kindLabel(filters.eventKind ?? "custom")}
            </strong>
            {/* Built-in kinds are named after their only event; saying it twice adds nothing. */}
            {filters.eventKind &&
            filters.eventName &&
            kindLabel(filters.eventKind) !== eventLabel(filters.eventKind, filters.eventName) ? (
              <Badge variant="outline">{kindLabel(filters.eventKind)}</Badge>
            ) : null}
            <Button variant="ghost" size="sm" onClick={onClear}>
              清除选择
            </Button>
          </>
        ) : (
          <span>全部事件</span>
        )}
      </div>
      <div
        className="event-freshness"
        data-stale={(!isFetching && freshness.stale) || undefined}
        role={freshness.stale ? "status" : undefined}
      >
        {freshness.stale && !isFetching ? <TriangleAlertIcon aria-hidden="true" /> : null}
        <span>{isFetching ? "正在更新…" : freshness.stale ? `${age}，可能不是最新` : age}</span>
        <small>统计为近似去重</small>
      </div>
    </div>
  );
}

function NoEvents({ projectId }: { projectId: string }) {
  return (
    <section className="behavior-panel" aria-label="没有事件">
      <EmptyState
        icon={ListTreeIcon}
        title="当前范围没有事件"
        description="放宽时间范围或清除筛选后重试；如果项目还没有上报，先接入 SDK，或在本地用「造数据」生成一批。"
        action={
          <div className="event-empty-actions">
            <Button asChild variant="outline" size="sm">
              <a href={`/projects/${encodeURIComponent(projectId)}/onboarding`}>接入 SDK</a>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <a href={`/projects/${encodeURIComponent(projectId)}/dev-data`}>造数据</a>
            </Button>
          </div>
        }
      />
    </section>
  );
}
