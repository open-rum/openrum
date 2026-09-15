import type { ReactNode } from "react";

import { ConsolePage, ConsolePageHeader } from "@/components/layout/ConsolePage";
import { AdminNav } from "./AdminNav";

export function AdminPageLayout({
  title,
  description,
  actions,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <ConsolePage width="wide" rail={<AdminNav />} railLabel="系统设置">
      <ConsolePageHeader title={title} description={description} actions={actions} />
      {children}
    </ConsolePage>
  );
}
