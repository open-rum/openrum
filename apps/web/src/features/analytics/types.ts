import type { BehaviorAnalyticsResponse } from "@/lib/api/analytics";

export type BehaviorTrendPoint = BehaviorAnalyticsResponse["trend"][number];
