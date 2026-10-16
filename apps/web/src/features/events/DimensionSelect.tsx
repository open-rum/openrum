import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { BehaviorDimension } from "@/lib/api/analytics";

const builtin: Array<{ value: BehaviorDimension; label: string }> = [
  { value: "country", label: "国家" },
  { value: "device", label: "设备" },
  { value: "browser", label: "浏览器" },
  { value: "source", label: "来源" },
];

/**
 * Chooses what a distribution splits the events by: a built-in dimension, or one of the
 * event properties the server allows for grouping.
 */
export function DimensionSelect({
  value,
  properties,
  onChange,
  label = "分布维度",
}: {
  value: BehaviorDimension;
  properties: Array<{ name: string; events: number }>;
  onChange: (dimension: BehaviorDimension) => void;
  label?: string;
}) {
  return (
    <Select value={value} onValueChange={(next) => onChange(next as BehaviorDimension)}>
      <SelectTrigger size="sm" className="event-dimension" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end">
        <SelectGroup>
          {builtin.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectGroup>
        {properties.length ? (
          <>
            <SelectSeparator />
            <SelectGroup>
              <SelectLabel>事件属性</SelectLabel>
              {properties.map((property) => (
                <SelectItem key={property.name} value={`property:${property.name}`}>
                  {property.name}
                </SelectItem>
              ))}
            </SelectGroup>
          </>
        ) : null}
        {/* A property chosen earlier may not exist for the event now showing. */}
        {value.startsWith("property:") &&
        !properties.some((p) => `property:${p.name}` === value) ? (
          <SelectGroup>
            <SelectItem value={value}>{value.slice("property:".length)}</SelectItem>
          </SelectGroup>
        ) : null}
      </SelectContent>
    </Select>
  );
}
