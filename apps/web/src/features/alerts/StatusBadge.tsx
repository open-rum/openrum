import { Badge } from "@/components/ui/badge";

export type StatusTone = "ok" | "danger" | "warning" | "muted";

const variants = {
  ok: "success",
  danger: "destructive",
  warning: "warning",
  muted: "secondary",
} as const satisfies Record<StatusTone, string>;

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
    <Badge variant={variants[tone]} title={title}>
      {label}
    </Badge>
  );
}
