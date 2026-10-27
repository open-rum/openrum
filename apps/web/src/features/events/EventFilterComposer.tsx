import { Globe2Icon, MonitorSmartphoneIcon, PackageIcon, RouteIcon, TagIcon } from "lucide-react";
import {
  SearchQueryInput,
  type SearchQueryError,
  type SearchQueryField,
} from "@/components/filters/SearchQueryInput";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { BehaviorAnalyticsResponse, BehaviorFilters, BehaviorKind } from "@/lib/api/analytics";
import { eventLabel } from "@/features/analytics/labels";
import { useSearchSuggest } from "@/lib/search/useSearchSuggest";

const allEvents = "__all__";

/**
 * Which event the Events page looks at, and a search that narrows the events by the
 * dimensions every page shares (page, country, device, browser, release) and by their
 * properties, such as attributes.plan:pro. How the distribution is split is chosen on its own
 * card, and measurements live in the event drawer: neither filters anything, so neither sits
 * beside the search.
 */
export function EventFilterComposer({
  filters,
  data,
  error,
  onChange,
}: {
  filters: BehaviorFilters;
  data?: BehaviorAnalyticsResponse;
  /** Why the server refused the search, if it did. */
  error?: SearchQueryError;
  onChange: (patch: Partial<BehaviorFilters>) => void;
}) {
  const suggest = useSearchSuggest({
    projectId: filters.projectId,
    dataset: "events",
    from: filters.from,
    to: filters.to,
    environment: filters.environment,
    // Property values of the event being explored come first.
    event: filters.eventKind === "custom" ? filters.eventName : undefined,
  });
  const selectedEvent = filters.eventKind
    ? `${filters.eventKind}:${filters.eventName ?? "*"}`
    : allEvents;
  return (
    <>
      <Select
        value={selectedEvent}
        onValueChange={(value) => {
          if (value === allEvents) {
            onChange({ eventKind: undefined, eventName: undefined });
            return;
          }
          const separator = value.indexOf(":");
          const eventName = value.slice(separator + 1);
          onChange({
            eventKind: value.slice(0, separator) as BehaviorKind,
            eventName: eventName === "*" ? undefined : eventName,
          });
        }}
      >
        <SelectTrigger aria-label="事件" className="event-filter-trigger">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={allEvents}>全部事件</SelectItem>
          <SelectItem value="page_view:*">全部页面访问</SelectItem>
          <SelectItem value="navigation:*">全部页面导航</SelectItem>
          <SelectItem value="click:*">全部点击</SelectItem>
          <SelectItem value="custom:*">全部自定义事件</SelectItem>
          {data?.catalog.length ? (
            <SelectGroup>
              <SelectLabel>事件</SelectLabel>
              {data.catalog.map((event) => (
                <SelectItem
                  key={`${event.kind}:${event.name}`}
                  value={`${event.kind}:${event.name}`}
                >
                  {eventLabel(event.kind, event.name)}
                </SelectItem>
              ))}
            </SelectGroup>
          ) : null}
        </SelectContent>
      </Select>
      <SearchQueryInput
        ariaLabel="搜索事件"
        placeholder="按页面、国家、设备或属性筛选，例如 route:/checkout AND attributes.plan:pro"
        value={filters.q ?? ""}
        onSubmit={(q) => onChange({ q })}
        fields={eventFields(data)}
        attributes
        suggest={suggest}
        recentKey="events"
        error={error}
      />
    </>
  );
}

/**
 * The shared dimensions first, then one field per property the events carry, so "属性 plan
 * 是 pro" is one choice away. Values come from the server's suggestions.
 */
function eventFields(data?: BehaviorAnalyticsResponse): SearchQueryField[] {
  return [
    {
      key: "route",
      type: "text",
      label: "页面",
      hint: "事件发生时的 Route 或页面 URL",
      aliases: ["page", "页面"],
      icon: RouteIcon,
    },
    {
      key: "country",
      type: "enum",
      label: "国家 / 地区",
      hint: "两位国家代码，例如 CN、US",
      icon: Globe2Icon,
    },
    {
      key: "device",
      type: "enum",
      label: "设备类型",
      hint: "desktop、mobile、tablet",
      aliases: ["deviceType"],
      icon: MonitorSmartphoneIcon,
    },
    {
      key: "browser",
      type: "enum",
      label: "浏览器",
      hint: "Chrome、Safari、Firefox 等",
      icon: MonitorSmartphoneIcon,
    },
    {
      key: "release",
      type: "text",
      label: "版本",
      hint: "SDK 上报的 Release",
      icon: PackageIcon,
    },
    ...(data?.properties.map((property) => ({
      key: `attributes.${property.name}`,
      type: "text" as const,
      label: `属性 ${property.name}`,
      hint: `${property.events.toLocaleString()} 个事件上报了它，${property.cardinality} 种取值`,
      aliases: [property.name],
      icon: TagIcon,
    })) ?? []),
    {
      key: "attributes.",
      type: "text",
      label: "其他属性",
      hint: "写成 attributes.名称:值",
      aliases: ["property", "属性"],
      icon: TagIcon,
    },
  ];
}
