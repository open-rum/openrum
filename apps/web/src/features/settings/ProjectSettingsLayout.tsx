import type { ReactNode } from "react";
import { ProjectSettingsNav } from "./ProjectSettingsNav";

type ProjectSettingsLayoutProps = {
  projectId: string;
  title: string;
  description: ReactNode;
  breadcrumb?: ReactNode;
  titleId?: string;
  children: ReactNode;
};

// The nav sits beside the content rather than above it, so adding a section
// does not push the form further down the page.
export function ProjectSettingsLayout({
  projectId,
  title,
  description,
  breadcrumb,
  titleId,
  children,
}: ProjectSettingsLayoutProps) {
  return (
    <section className="mx-auto w-full max-w-5xl px-6 py-8" aria-labelledby={titleId}>
      <header className="border-b border-border pb-6">
        {breadcrumb ? <p className="text-xs text-muted-foreground">{breadcrumb}</p> : null}
        <h1 id={titleId} className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
          {title}
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{description}</p>
      </header>
      <div className="mt-6 grid gap-6 md:grid-cols-[10rem_minmax(0,1fr)] md:gap-8">
        <ProjectSettingsNav projectId={projectId} />
        <div className="min-w-0">{children}</div>
      </div>
    </section>
  );
}
