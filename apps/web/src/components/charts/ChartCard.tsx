import { InfoIcon } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * The frame every Console chart sits in: a title with an optional info icon, an optional
 * control on the right, and a body that fills a fixed height. Cards in a row share that
 * height, so a row stays level whatever each chart holds. Explanations belong behind the
 * info icon, not under the chart.
 */
export function ChartCard({
  id,
  title,
  info,
  action,
  className,
  children,
}: {
  /** Names the heading, which labels the card for assistive technology. */
  id: string;
  title: React.ReactNode;
  info?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={cn("chart-card", className)} aria-labelledby={id}>
      <header>
        <div>
          <h2 id={id}>{title}</h2>
          {info ? <ChartInfo>{info}</ChartInfo> : null}
        </div>
        {action}
      </header>
      <div className="chart-card__body">{children}</div>
    </section>
  );
}

/** An explanation that stays out of the way until asked for. */
export function ChartInfo({ children }: { children: React.ReactNode }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" className="chart-info" aria-label="说明">
            <InfoIcon aria-hidden="true" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="start" className="chart-info__content">
          <div>{children}</div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
