import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  type BehaviorAnalyticsResponse,
  type BehaviorDimension,
  type BehaviorFilters,
  type BehaviorKind,
} from "@/lib/api/analytics";
import { eventLabel } from "./labels";

export function BehaviorControls({
  filters,
  data,
  onChange,
  showEvent = true,
}: {
  filters: BehaviorFilters;
  data?: BehaviorAnalyticsResponse;
  onChange: (patch: Partial<BehaviorFilters>) => void;
  showEvent?: boolean;
}) {
  const eventValue = filters.eventName
    ? `${filters.eventKind ?? "custom"}:${filters.eventName}`
    : filters.eventKind
      ? `${filters.eventKind}:*`
      : "all";
  return (
    <div className="behavior-toolbar" aria-label="行为分析筛选">
      {showEvent ? (
        <Select
          value={eventValue}
          onValueChange={(value) => {
            if (value === "all") return onChange({ eventKind: undefined, eventName: undefined });
            const separator = value.indexOf(":");
            const kind = value.slice(0, separator) as BehaviorKind;
            const name = value.slice(separator + 1);
            onChange({ eventKind: kind, eventName: name === "*" ? undefined : name });
          }}
        >
          <SelectTrigger aria-label="行为事件" className="min-w-40">
            <SelectValue placeholder="全部行为事件" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="all">全部行为事件</SelectItem>
              <SelectItem value="page_view:*">全部页面访问</SelectItem>
              <SelectItem value="navigation:*">全部页面导航</SelectItem>
              <SelectItem value="click:*">全部点击</SelectItem>
              <SelectItem value="custom:*">全部自定义事件</SelectItem>
              {data?.catalog.map((event) => (
                <SelectItem
                  key={`${event.kind}:${event.name}`}
                  value={`${event.kind}:${event.name}`}
                >
                  {eventLabel(event.kind, event.name)}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      ) : null}
      <Select
        value={filters.dimension}
        onValueChange={(value) => onChange({ dimension: value as BehaviorDimension })}
      >
        <SelectTrigger aria-label="分群维度" className="min-w-32">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value="country">国家</SelectItem>
            <SelectItem value="device">设备</SelectItem>
            <SelectItem value="browser">浏览器</SelectItem>
            <SelectItem value="source">来源</SelectItem>
            {data?.properties.map((property) => (
              <SelectItem key={property.name} value={`property:${property.name}`}>
                属性 · {property.name}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      <span className="behavior-toolbar__note">近似去重 · 最多 100 个分群值</span>
    </div>
  );
}
