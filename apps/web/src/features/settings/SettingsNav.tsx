import { Link, useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";
import {
  ArrowLeft,
  BellRingIcon,
  ClipboardListIcon,
  ChartColumnIcon,
  DatabaseIcon,
  HardDriveIcon,
  PlugZapIcon,
  ServerCogIcon,
  SlidersHorizontalIcon,
  UserRoundIcon,
  UsersRoundIcon,
} from "lucide-react";

import type { Project } from "@/lib/api/projects";
import { projectDataSettings } from "./projectDataSettings";

// One menu for every scope a setting can belong to. Settings used to live in three
// navigations that shared no entry point — a project rail, an account rail reached from
// the sidebar footer, and `/admin` — so a value capped at the instance (retention is the
// live example) could not link to the value it capped. Listing all four scopes at once is
// what makes those references possible in both directions.
//
// App owns the scope data and passes it here so the hidden panel does not subscribe to a
// second copy of the same organization, project, and session queries.

const itemClassName = "settings-sidebar-nav__item";
const activeProps = { className: "is-active" };

export function SettingsNav({
  organizationName,
  project,
  showInstance,
  instanceOwner,
}: {
  organizationName?: string;
  project?: Project;
  showInstance: boolean;
  instanceOwner: boolean;
}) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  return (
    <div className="settings-sidebar-nav">
      <Link
        to={project ? "/projects/$projectId/overview" : "/projects"}
        params={project ? { projectId: project.id } : undefined}
        className="settings-sidebar-nav__back"
        aria-label="返回设置"
      >
        <ArrowLeft size={16} aria-hidden="true" />
        <span>返回设置</span>
      </Link>

      <Scope label="账户">
        <NavItem to="/settings/account" icon={<UserRoundIcon />} exact>
          个人资料
        </NavItem>
      </Scope>

      <Scope label="组织" badge={organizationName}>
        <NavItem to="/settings/org/members" icon={<UsersRoundIcon />} exact>
          成员与权限
        </NavItem>
        <NavItem to="/settings/org/channels" icon={<BellRingIcon />}>
          通知渠道
        </NavItem>
      </Scope>

      {project ? (
        <Scope label="项目" badge={project.name}>
          <NavItem
            to="/settings/project/$projectId/general"
            params={{ projectId: project.id }}
            icon={<SlidersHorizontalIcon />}
            exact
          >
            常规
          </NavItem>
          <NavItem
            to="/projects/$projectId/onboarding"
            params={{ projectId: project.id }}
            icon={<PlugZapIcon />}
          >
            接入指引
          </NavItem>

          <NavItem
            to="/settings/project/$projectId/sampling"
            params={{ projectId: project.id }}
            icon={<DatabaseIcon />}
            active={projectDataSettings.some(
              (item) => pathname.replace(/\/$/, "") === item.path.replace("$projectId", project.id),
            )}
          >
            数据管理
          </NavItem>
          <NavItem
            to="/settings/project/$projectId/usage"
            params={{ projectId: project.id }}
            icon={<ChartColumnIcon />}
          >
            用量统计
          </NavItem>
        </Scope>
      ) : null}

      {/* Mirrors the condition the instance routes enforce: without an instance role the
          whole scope is absent rather than present and rejecting. */}
      {showInstance ? (
        <Scope label="实例" badge={instanceOwner ? "Owner" : "Admin"}>
          <NavItem to="/settings/instance" icon={<ServerCogIcon />} exact>
            实例概览
          </NavItem>
          <NavItem to="/settings/instance/retention" icon={<DatabaseIcon />}>
            数据生命周期
          </NavItem>
          <NavItem to="/settings/instance/object-storage" icon={<HardDriveIcon />}>
            对象存储
          </NavItem>
          {instanceOwner ? (
            <NavItem to="/settings/instance/authentication" icon={<ServerCogIcon />}>
              认证与访问
            </NavItem>
          ) : null}
          <NavItem to="/settings/instance/audit" icon={<ClipboardListIcon />}>
            维护与审计
          </NavItem>
        </Scope>
      ) : null}
    </div>
  );
}

function Scope({ label, badge, children }: { label: string; badge?: string; children: ReactNode }) {
  return (
    <section className="settings-sidebar-nav__scope">
      <div className="settings-sidebar-nav__scope-heading">
        <h2>{label}</h2>
        {badge ? <span title={badge}>{badge}</span> : null}
      </div>
      <nav className="settings-sidebar-nav__items" aria-label={`设置 · ${label}`}>
        {children}
      </nav>
    </section>
  );
}

function NavItem({
  to,
  params,
  icon,
  exact = false,
  active,
  children,
}: {
  to: string;
  params?: { projectId: string };
  icon: ReactNode;
  exact?: boolean;
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <Link
      // The route table is generated from literal paths, so `to` is widened here rather
      // than threading every settings path through this one component's type.
      to={to as never}
      params={params as never}
      activeOptions={exact ? { exact: true } : undefined}
      className={`${itemClassName}${active ? " is-active" : ""}`}
      aria-current={active ? "page" : undefined}
      activeProps={activeProps}
    >
      <span className="settings-sidebar-nav__icon" aria-hidden="true">
        {icon}
      </span>
      <span className="settings-sidebar-nav__label">{children}</span>
    </Link>
  );
}
