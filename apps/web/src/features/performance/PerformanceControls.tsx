import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { performancePercentiles, type PerformancePercentile } from "@/lib/api/performance";

export function PercentileSelect({
  value,
  onChange,
}: {
  value: PerformancePercentile;
  onChange: (value: PerformancePercentile) => void;
}) {
  return (
    <Select
      value={value}
      onValueChange={(next) => {
        if (next) onChange(next as PerformancePercentile);
      }}
    >
      <SelectTrigger size="sm" className="w-20" aria-label="统计分位数">
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper" align="end">
        <SelectGroup>
          {performancePercentiles.map((p) => (
            <SelectItem key={p} value={p}>
              {p.toUpperCase()}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
