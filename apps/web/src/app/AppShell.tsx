import type { ReactNode } from "react";
import { Outlet } from "@tanstack/react-router";

export function AppShell({
  navigation,
  statusBar,
  banner,
  floatingTools,
  sidebarCollapsed = false,
}: {
  navigation: ReactNode;
  statusBar: ReactNode;
  banner?: ReactNode;
  floatingTools?: ReactNode;
  sidebarCollapsed?: boolean;
}) {
  return (
    <div className="app-shell" data-sidebar-state={sidebarCollapsed ? "collapsed" : "expanded"}>
      <a className="skip-link" href="#main-content">
        跳到主要内容
      </a>
      <aside className="sidebar" id="app-sidebar" aria-label="主导航">
        {navigation}
      </aside>
      <main className="app-main" id="main-content" tabIndex={-1}>
        {statusBar}
        {banner ? <div className="app-global-banner">{banner}</div> : null}
        <Outlet />
      </main>
      {floatingTools}
    </div>
  );
}
