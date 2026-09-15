import type { ReactNode } from "react";
import {
  ConsolePage,
  ConsolePageContent,
  ConsolePageHeader,
} from "@/components/layout/ConsolePage";
import { ProjectSettingsNav } from "./ProjectSettingsNav";

type ProjectSettingsLayoutProps = {
  projectId: string;
  title: string;
  description: ReactNode;
  titleId?: string;
  children: ReactNode;
};

// The nav sits beside the content rather than above it, so adding a section
// does not push the form further down the page.
export function ProjectSettingsLayout({
  projectId,
  title,
  description,
  titleId,
  children,
}: ProjectSettingsLayoutProps) {
  return (
    <ConsolePage
      width="narrow"
      rail={<ProjectSettingsNav projectId={projectId} />}
      railLabel="项目设置导航"
    >
      <ConsolePageHeader title={title} description={description} titleId={titleId} />
      <ConsolePageContent>{children}</ConsolePageContent>
    </ConsolePage>
  );
}
