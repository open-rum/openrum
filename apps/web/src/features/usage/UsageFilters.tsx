import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { usageRange } from "@/lib/api/usage";
import { usageTypes, type UsageRange } from "./organizationUsage";

export function UsageFilters({
  range,
  onChange,
}: {
  range: UsageRange;
  onChange: (patch: Record<string, string>) => void;
}) {
  const duration = (range.to.getTime() - range.from.getTime()) / 86400000;
  return (
    <>
      <Select
        value={range.eventType ?? "all"}
        onValueChange={(eventType) => onChange({ eventType })}
      >
        <SelectTrigger aria-label="事件类型" className="min-w-36">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {usageTypes.map(([value, label]) => (
            <SelectItem key={value} value={value}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <ToggleGroup
        type="single"
        variant="selection"
        aria-label="用量时间范围"
        className="flex-wrap"
        value={String(duration)}
        onValueChange={(value) => {
          if (!value) return;
          const next = usageRange(Number(value));
          onChange({ from: next.from.toISOString(), to: next.to.toISOString() });
        }}
      >
        {[1, 7, 30, 90].map((days) => (
          <ToggleGroupItem key={days} value={String(days)}>
            {days === 1 ? "最近 24 小时" : `最近 ${days} 天`}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </>
  );
}
