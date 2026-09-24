import { createContext, useContext } from "react";
import { TIME_SERIES_MAX_POINTS } from "@/lib/charts/timeSeries";

// Compatibility exports: new consumers use lib/charts/timeSeries directly.
export {
  chartTicks,
  continuousRows,
  intervalLabel,
  intervalSeconds,
  timeTickLabel,
} from "@/lib/charts/timeSeries";
export const DASHBOARD_MAX_POINTS = TIME_SERIES_MAX_POINTS;
export const DashboardPointBudgetContext = createContext(TIME_SERIES_MAX_POINTS);

export function useDashboardPointBudget() {
  return useContext(DashboardPointBudgetContext);
}
