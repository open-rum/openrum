import type { ReactNode } from "react";
import { DASHBOARD_MAX_POINTS, DashboardPointBudgetContext } from "./chartDensity";

export function DashboardDensity({ children }: { children: ReactNode }) {
  return (
    <div className="w-full min-w-0">
      <DashboardPointBudgetContext value={DASHBOARD_MAX_POINTS}>
        {children}
      </DashboardPointBudgetContext>
    </div>
  );
}
