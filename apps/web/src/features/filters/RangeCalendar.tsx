import { useState } from "react";
import { DayPicker, type DateRange } from "react-day-picker";
import { zhCN } from "react-day-picker/locale";

/** The most a custom range may span, in calendar days (it matches the 30-day query limit). */
const MAX_RANGE_DAYS = 30;

/**
 * The two-month range picker of the custom time range, drawn by daisyUI's `react-day-picker`
 * styles. It lives in its own module so the date-picker and date libraries load when someone
 * opens the custom range, not with every page.
 *
 * Days after today are disabled (no data exists there yet), days of the neighbouring months
 * are hidden so one range is never drawn twice, and once a start is picked the days up to the
 * pointer are previewed as the range they would make. A click on a finished range starts a
 * new one there, rather than stretching the old range the way DayPicker does by default.
 */
export default function RangeCalendar({
  selected,
  onSelect,
  defaultMonth,
  months = 2,
  today = new Date(),
}: {
  selected: DateRange;
  onSelect: (range: DateRange | undefined) => void;
  defaultMonth: Date;
  /** Two months side by side on wide screens, one on a phone. */
  months?: number;
  /** Injected by tests; the calendar otherwise treats the current day as today. */
  today?: Date;
}) {
  const [hovered, setHovered] = useState<Date | undefined>();
  const choosingEnd = Boolean(
    selected.from && (!selected.to || selected.to.getTime() === selected.from.getTime()),
  );
  const preview =
    choosingEnd && selected.from && hovered
      ? hovered < selected.from
        ? { from: hovered, to: selected.from }
        : { from: selected.from, to: hovered }
      : undefined;
  return (
    <div data-slot="calendar" onMouseLeave={() => setHovered(undefined)}>
      <DayPicker
        className="react-day-picker analysis-time-popover__calendar-grid"
        mode="range"
        selected={selected}
        onSelect={(range, day) => {
          if (selected.from && selected.to && !choosingEnd) onSelect({ from: day, to: undefined });
          else onSelect(range);
        }}
        numberOfMonths={months}
        max={MAX_RANGE_DAYS}
        defaultMonth={defaultMonth}
        today={today}
        locale={zhCN}
        showOutsideDays={false}
        disabled={{ after: today }}
        endMonth={today}
        modifiers={preview ? { preview } : undefined}
        modifiersClassNames={{ preview: "rdp-range_preview" }}
        onDayMouseEnter={(day) => setHovered(day)}
      />
    </div>
  );
}
