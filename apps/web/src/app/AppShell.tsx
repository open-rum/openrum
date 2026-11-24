import type { ReactNode } from "react";
import { Outlet } from "@tanstack/react-router";

export function AppShell({
  navigation,
  statusBar,
  banner,
  floatingTools,
  sidebarCollapsed = false,
  contentKey,
  content,
}: {
  navigation: ReactNode;
  statusBar: ReactNode;
  banner?: ReactNode;
  floatingTools?: ReactNode;
  sidebarCollapsed?: boolean;
  /** A project switch resets local page drafts and selections to the new project's data. */
  contentKey?: string;
  content?: ReactNode;
}) {
  return (
    <div
      className="app-shell"
      data-sidebar-state={sidebarCollapsed ? "collapsed" : "expanded"}
      data-floating-tools={floatingTools ? "" : undefined}
    >
      <a className="skip-link" href="#main-content">
        跳到主要内容
      </a>
      <aside className="sidebar" id="app-sidebar" aria-label="主导航">
        {navigation}
      </aside>
      <main className="app-main" id="main-content" tabIndex={-1}>
        {statusBar}
        {banner ? <div className="app-global-banner">{banner}</div> : null}
        {content ?? <Outlet key={contentKey} />}
      </main>
      {floatingTools}
    </div>
  );
}
