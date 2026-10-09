import type { DateRange } from "react-day-picker";
import { zhCN } from "react-day-picker/locale";
import { Calendar } from "@/components/ui/calendar";

/**
 * The two-month range picker of the custom time range. It lives in its own module so the
 * date-picker and date libraries load when someone opens the custom range, not with every page.
 */
export default function RangeCalendar({
  selected,
  onSelect,
  defaultMonth,
}: {
  selected: DateRange;
  onSelect: (range: DateRange | undefined) => void;
  defaultMonth: Date;
}) {
  return (
    <Calendar
      mode="range"
      selected={selected}
      onSelect={onSelect}
      numberOfMonths={2}
      max={30}
      defaultMonth={defaultMonth}
      locale={zhCN}
      className="analysis-time-popover__calendar-grid"
    />
  );
}
