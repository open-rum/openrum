import {
  Bell,
  CaretDown,
  ChartLineUp,
  DotsThreeVertical,
  Gauge,
  GearSix,
  PlayCircle,
  Plug,
  Pulse,
  SquaresFour,
  SignOut,
  UserCircle,
  WarningCircle,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link, Outlet } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { listOrganizations, listProjects } from "@/lib/api/projects";
import { logout, sessionQueryOptions } from "@/lib/auth/session";

const navigation = [
  { label: "数据大盘", icon: SquaresFour, to: "/" },
  { label: "接入项目", icon: Plug, to: "/onboarding" },
  { label: "异常栈", icon: WarningCircle, to: "/issues" },
  { label: "回放列表", icon: PlayCircle, to: "/replays" },
  { label: "性能追踪", icon: Gauge, to: "/performance" },
  { label: "API 监控", icon: Pulse, to: "/apis" },
  { label: "告警配置", icon: Bell, to: "/alerts" },
  { label: "设置", icon: GearSix, to: "/settings" },
] as const;

export function App() {
  const queryClient = useQueryClient();
  const { data: user } = useSuspenseQuery(sessionQueryOptions());
  const organizationsQuery = useQuery({ queryKey: ["organizations"], queryFn: listOrganizations });
  const organization = organizationsQuery.data?.organizations[0];
  const projectsQuery = useQuery({
    queryKey: ["projects", organization?.id],
    queryFn: () => listProjects(organization!.id),
    enabled: Boolean(organization),
  });
  const project = projectsQuery.data?.projects[0];
  const signOut = useMutation({
    mutationFn: logout,
    onSuccess: () => {
      queryClient.clear();
      window.location.replace("/login");
    },
  });

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="主导航">
        <Link className="brand" to="/" aria-label="OpenRUM 数据大盘">
          <span className="brand__mark">
            <ChartLineUp weight="bold" />
          </span>
          <span>OpenRUM</span>
        </Link>

        <Link
          className="project-switcher"
          to="/onboarding"
          aria-label={project ? "查看或创建项目" : "创建首个项目"}
        >
          <span>
            <strong>
              {project?.name ?? (projectsQuery.isLoading ? "加载项目…" : "创建首个项目")}
            </strong>
            <small>
              <i />
              {project?.environment ?? organization?.name ?? "尚未配置"}
            </small>
          </span>
          <CaretDown size={14} />
        </Link>

        <nav className="sidebar__nav">
          {navigation.map(({ label, icon: Icon, to }) => (
            <Link
              key={to}
              className="nav-item"
              to={to}
              activeOptions={{ exact: to === "/" }}
              activeProps={{ className: "is-active" }}
            >
              <Icon size={17} />
              <span>{label}</span>
            </Link>
          ))}
        </nav>

        <div className="sidebar__footer">
          <div className="time-card">
            <small>当前时间</small>
            <strong>2026-09-02 14:35:22</strong>
            <span>(Asia/Shanghai)</span>
          </div>
          <div className="operator-card">
            <span className="operator-card__avatar">
              <UserCircle size={25} weight="fill" />
            </span>
            <span>
              <strong>{user.displayName}</strong>
              <small title={user.email}>{user.email}</small>
            </span>
            <DotsThreeVertical size={16} aria-hidden="true" />
          </div>
          <div className="sidebar__actions">
            <ThemeToggle />
            <Button
              type="button"
              variant="outline"
              size="icon-lg"
              aria-label="退出登录"
              title="退出登录"
              disabled={signOut.isPending}
              onClick={() => signOut.mutate()}
            >
              <SignOut />
            </Button>
          </div>
          {signOut.error ? <p className="sidebar__error">退出失败，请重试。</p> : null}
        </div>
      </aside>

      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
