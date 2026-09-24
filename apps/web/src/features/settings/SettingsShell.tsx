import type { ReactNode } from "react";

import {
  ConsolePage,
  ConsolePageContent,
  ConsolePageHeader,
  ConsolePageTabs,
} from "@/components/layout/ConsolePage";

// Every settings page — account, organization, project, instance — renders through this
// one shell. Scope navigation lives in App's persistent sidebar so every settings page
// keeps the same content width and does not repeat a second rail inside the workspace.
export function SettingsShell({
  title,
  description,
  titleId,
  actions,
  tabs,
  width = "narrow",
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  titleId?: string;
  actions?: ReactNode;
  tabs?: ReactNode;
  width?: "narrow" | "wide";
  children: ReactNode;
}) {
  return (
    <ConsolePage width={width}>
      <ConsolePageHeader
        title={title}
        description={description}
        titleId={titleId}
        actions={actions}
      />
      {tabs ? <ConsolePageTabs>{tabs}</ConsolePageTabs> : null}
      <ConsolePageContent>{children}</ConsolePageContent>
    </ConsolePage>
  );
}
