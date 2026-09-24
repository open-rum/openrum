import type { ReactNode } from "react";

import { ConsolePage, ConsolePageHeader } from "@/components/layout/ConsolePage";

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
    <ConsolePage width="wide">
      <ConsolePageHeader title={title} description={description} actions={actions} />
      {children}
    </ConsolePage>
  );
}
