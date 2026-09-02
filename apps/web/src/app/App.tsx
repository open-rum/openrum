import {
  Bell,
  CaretDown,
  ChartLineUp,
  DotsThreeVertical,
  Gauge,
  GearSix,
  PlayCircle,
  Pulse,
  SquaresFour,
  UserCircle,
  WarningCircle,
} from "@phosphor-icons/react";
import { Link, Outlet } from "@tanstack/react-router";

const navigation = [
  { label: "数据大盘", icon: SquaresFour, to: "/" },
  { label: "异常栈", icon: WarningCircle, to: "/issues" },
  { label: "回放列表", icon: PlayCircle, to: "/replays" },
  { label: "性能追踪", icon: Gauge, to: "/performance" },
  { label: "API 监控", icon: Pulse, to: "/apis" },
  { label: "告警配置", icon: Bell, to: "/alerts" },
  { label: "设置", icon: GearSix, to: "/settings" },
] as const;

export function App() {
  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="主导航">
        <Link className="brand" to="/" aria-label="OpenRUM 数据大盘">
          <span className="brand__mark">
            <ChartLineUp weight="bold" />
          </span>
          <span>OpenRUM</span>
        </Link>

        <button className="project-switcher" type="button" aria-label="切换项目">
          <span>
            <strong>商城 H5</strong>
            <small>
              <i />
              生产环境
            </small>
          </span>
          <CaretDown size={14} />
        </button>

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
          <button className="operator-card" type="button">
            <span className="operator-card__avatar">
              <UserCircle size={25} weight="fill" />
            </span>
            <span>
              <strong>运维工程师</strong>
              <small>admin</small>
            </span>
            <DotsThreeVertical size={16} />
          </button>
        </div>
      </aside>

      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
