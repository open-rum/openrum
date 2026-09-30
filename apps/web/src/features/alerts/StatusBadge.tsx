import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type StatusTone = "ok" | "danger" | "warning" | "muted";

const dots: Record<StatusTone, string> = {
  ok: "bg-[var(--ds-success)]",
  danger: "bg-[var(--ds-danger)]",
  warning: "bg-[var(--ds-warning)]",
  muted: "bg-muted-foreground/50",
};

/** A neutral badge with a semantic dot, so status reads without relying on fill colour. */
export function StatusBadge({
  tone,
  label,
  title,
}: {
  tone: StatusTone;
  label: string;
  title?: string;
}) {
  return (
    <Badge variant="outline" className="gap-1.5 font-normal" title={title}>
      <span aria-hidden="true" className={cn("size-1.5 rounded-full", dots[tone])} />
      {label}
    </Badge>
  );
}
