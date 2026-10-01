import { Badge } from "@/components/ui/badge";

export function ArtifactStatus({ status }: { status: "pending" | "ready" | "failed" }) {
  return (
    <Badge
      variant={status === "ready" ? "success" : status === "failed" ? "destructive" : "outline"}
    >
      {status === "ready" ? "可用" : status === "failed" ? "失败" : "校验中"}
    </Badge>
  );
}
