import type { ReactNode } from "react";
import { ThemeToggle } from "@/components/theme/ThemeToggle";

export function AppStatusBar({ context }: { context?: ReactNode }) {
  return (
    <header className="app-status-bar" role="region" aria-label="应用状态栏">
      {context}
      <div className="app-status-bar__actions" aria-label="全局操作">
        <ThemeToggle compact />
      </div>
    </header>
  );
}
