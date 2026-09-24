export function isPipelineDelayed(
  status: { lastEventReceivedAt: string | null; lastEventQueryableAt: string | null } | undefined,
  thresholdSeconds = 120,
) {
  if (!status?.lastEventReceivedAt) return false;
  if (!status.lastEventQueryableAt) return true;
  return (
    Date.parse(status.lastEventReceivedAt) - Date.parse(status.lastEventQueryableAt) >
    thresholdSeconds * 1000
  );
}
