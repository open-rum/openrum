import { dashboardResponseSchema, type DashboardConfig } from "@/features/dashboard/model";
import { csrfHeaders } from "@/lib/auth/session";
import { requestJSON } from "./client";

const path = (projectId: string) =>
  `/api/v1/projects/${encodeURIComponent(projectId)}/overview/config`;
export function getDashboard(projectId: string, signal?: AbortSignal) {
  return requestJSON(dashboardResponseSchema, path(projectId), { signal });
}
export function saveDashboard(projectId: string, config: DashboardConfig, revision: number) {
  return requestJSON(dashboardResponseSchema, path(projectId), {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ config, revision }),
  });
}
