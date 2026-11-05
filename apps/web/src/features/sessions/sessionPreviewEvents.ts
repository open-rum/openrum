import type { SessionTimelineEvent } from "@/lib/api/sessions";

function abnormal(event: SessionTimelineEvent) {
  return (
    event.kind === "error" ||
    (event.kind === "api" && (Boolean(event.apiFailure) || (event.apiStatus ?? 0) >= 400)) ||
    (event.kind === "log" && ["warn", "error", "fatal"].includes(event.logLevel ?? ""))
  );
}

/** A bounded preview favours failures and user actions, while retaining chronological order. */
export function sessionPreviewEvents(events: SessionTimelineEvent[]) {
  const meaningful = events.filter(
    (event) =>
      abnormal(event) || ["page_view", "navigation", "click", "custom"].includes(event.kind),
  );
  if (!meaningful.length) return events.slice(0, 6);
  const priority = [
    ...new Set([...meaningful.filter(abnormal), ...meaningful].map((event) => event.eventId)),
  ];
  const selected = new Set(priority.slice(0, 6));
  return events.filter((event) => selected.has(event.eventId));
}
