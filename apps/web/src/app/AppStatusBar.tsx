import type { ReactNode } from "react";
import { ThemeToggle } from "@/components/theme/ThemeToggle";

export function AppStatusBar({
  context,
  navigationToggle,
}: {
  context?: ReactNode;
  navigationToggle: ReactNode;
}) {
  return (
    <header className="app-status-bar" role="region" aria-label="应用状态栏">
      {navigationToggle}
      {context}
      <div className="app-status-bar__actions" aria-label="全局操作">
        <ThemeToggle compact />
      </div>
    </header>
  );
}
