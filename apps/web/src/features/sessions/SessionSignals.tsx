import { Badge } from "@/components/ui/badge";
import type { SessionSummary } from "@/lib/api/sessions";
import { performanceRating, ratingBadge, ratingLabel } from "@/features/performance/score";

export function SessionSignals({
  session,
}: {
  session: Pick<SessionSummary, "errors" | "apiFailures" | "lcp">;
}) {
  const rating = performanceRating(session.lcp ?? null, "LCP");
  return (
    <div className="session-signals">
      {session.errors > 0 ? <Badge variant="destructive">{session.errors} 错误</Badge> : null}
      {session.apiFailures > 0 ? (
        <Badge variant="warning">{session.apiFailures} API 失败</Badge>
      ) : null}
      {session.errors === 0 && session.apiFailures === 0 ? (
        <Badge variant="secondary">无错误/API 失败</Badge>
      ) : null}
      {rating !== "unknown" ? (
        <span className={`badge badge-soft badge-sm ${ratingBadge[rating]}`}>
          LCP {ratingLabel(rating)}
        </span>
      ) : null}
    </div>
  );
}
