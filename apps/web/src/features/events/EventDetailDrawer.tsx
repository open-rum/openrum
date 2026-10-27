import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChartLineIcon, ListIcon, XIcon } from "lucide-react";
import { AsyncError } from "@/components/ui/AsyncState";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { eventLabel } from "@/features/analytics/labels";
import {
  getBehaviorAnalytics,
  getBehaviorSamples,
  type BehaviorDimension,
  type BehaviorFilters,
  type BehaviorKind,
} from "@/lib/api/analytics";
import { TIME_SERIES_MAX_POINTS } from "@/lib/charts/timeSeries";
import { appendTerms } from "@/lib/search/query";
import { formatTerm } from "@/lib/search/terms";
import { kindLabel } from "./catalog";
import { EventDetailOverview } from "./EventDetailOverview";
import { EventSamples } from "./EventSamples";

type ChosenValue = { property: string; value: string };

const chosenKey = (item: ChosenValue) => `${item.property}\u0000${item.value}`;

const valueTerm = (item: ChosenValue) =>
  formatTerm({
    field: `attributes.${item.property}`,
    negated: false,
    operator: "eq",
    values: [item.value],
  });

/**
 * Everything about one event in the page's time range, in two tabs like the API detail: an
 * overview of its figures, properties and distribution, and its recent raw samples. It runs
 * its own queries, so opening an event never changes the page, and property values chosen
 * here narrow only the drawer. The page's own event selector filters the page.
 */
export function EventDetailDrawer({
  filters,
  kind,
  name,
  onClose,
}: {
  filters: BehaviorFilters;
  kind: BehaviorKind;
  name: string;
  onClose: () => void;
}) {
  const [dimension, setDimension] = useState<BehaviorDimension>(filters.dimension);
  const [measurement, setMeasurement] = useState<string>();
  const [chosen, setChosen] = useState<ChosenValue[]>([]);
  const [tab, setTab] = useState("overview");
  const [samplesOpened, setSamplesOpened] = useState(false);
  const q = chosen.length ? appendTerms(filters.q ?? "", chosen.map(valueTerm)) : filters.q;
  const scoped: BehaviorFilters = {
    ...filters,
    eventKind: kind,
    eventName: name,
    dimension,
    measurement,
    q,
  };
  const request = { ...scoped, maxPoints: TIME_SERIES_MAX_POINTS };
  const query = useQuery({
    queryKey: ["event-detail", request],
    queryFn: ({ signal }) => getBehaviorAnalytics(request, signal),
    // Switching the distribution keeps the figures on screen instead of blanking the drawer.
    placeholderData: keepPreviousData,
  });
  // The distribution and measurement do not change which events are sampled.
  const sampleFilters: BehaviorFilters = {
    ...scoped,
    dimension: "country",
    measurement: undefined,
  };
  // Samples scan raw events, so they are read once the tab is first opened, then kept.
  const samples = useQuery({
    queryKey: ["behavior-samples", sampleFilters],
    queryFn: ({ signal }) => getBehaviorSamples(sampleFilters, signal),
    enabled: samplesOpened,
  });
  const data = query.data;
  const chosenKeys = new Set(chosen.map(chosenKey));
  const toggleValue = (property: string, value: string) => {
    const item = { property, value };
    setChosen((current) =>
      current.some((entry) => chosenKey(entry) === chosenKey(item))
        ? current.filter((entry) => chosenKey(entry) !== chosenKey(item))
        : // One value per property: a second value of the same property replaces the first.
          [...current.filter((entry) => entry.property !== property), item],
    );
  };

  return (
    <Drawer open direction="right" onOpenChange={(open) => !open && onClose()}>
      <DrawerContent className="event-detail-drawer">
        <DrawerHeader className="event-detail-drawer__header">
          <div>
            <span>{kindLabel(kind)}</span>
            <DrawerTitle>{eventLabel(kind, name)}</DrawerTitle>
            <DrawerDescription>
              {filters.from.toLocaleString("zh-CN")} – {filters.to.toLocaleString("zh-CN")}
            </DrawerDescription>
          </div>
          <Button variant="ghost" size="icon" aria-label="关闭事件详情" onClick={onClose}>
            <XIcon />
          </Button>
        </DrawerHeader>
        {chosen.length ? (
          <div className="event-detail-drawer__chosen" aria-label="详情筛选">
            <span>只看</span>
            {chosen.map((item) => (
              <span key={chosenKey(item)} className="event-detail-drawer__chip">
                <code>
                  {item.property} = {item.value || "空值"}
                </code>
                <button
                  type="button"
                  aria-label={`移除 ${item.property} = ${item.value || "空值"}`}
                  onClick={() => toggleValue(item.property, item.value)}
                >
                  <XIcon aria-hidden="true" />
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <Tabs
          value={tab}
          onValueChange={(next) => {
            setTab(next);
            if (next === "samples") setSamplesOpened(true);
          }}
          className="api-detail-tabs"
        >
          <TabsList variant="line" aria-label="事件详情分区" className="api-detail-tablist">
            <TabsTrigger value="overview">
              <ChartLineIcon aria-hidden="true" />
              概览
            </TabsTrigger>
            <TabsTrigger value="samples">
              <ListIcon aria-hidden="true" />
              样本
              {samples.data ? (
                <span className="api-detail-tab-count">{samples.data.samples.length}</span>
              ) : null}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="overview" className="event-detail-drawer__body">
            {query.isLoading ? <Skeleton className="h-64" /> : null}
            {query.error ? (
              <AsyncError
                error={query.error}
                title="事件详情加载失败"
                remediation="可以缩短时间范围后重试。"
                onRetry={() => void query.refetch()}
              />
            ) : null}
            {data ? (
              <EventDetailOverview
                data={data}
                dimension={dimension}
                measurement={measurement}
                chosen={chosenKeys}
                onChangeDimension={setDimension}
                onSelectMeasurement={setMeasurement}
                onToggleValue={toggleValue}
              />
            ) : null}
          </TabsContent>
          <TabsContent value="samples" className="event-detail-drawer__body">
            <EventSamples
              projectId={filters.projectId}
              range={{ from: filters.from, to: filters.to }}
              page={samples.data}
              isLoading={samples.isLoading}
              error={samples.error}
              onRetry={() => void samples.refetch()}
            />
          </TabsContent>
        </Tabs>
      </DrawerContent>
    </Drawer>
  );
}
