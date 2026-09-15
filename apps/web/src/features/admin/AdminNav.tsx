import { Link } from "@tanstack/react-router";
import { ConsolePageRail } from "@/components/layout/ConsolePage";

const upcomingSections = ["认证与访问", "通知"];

export function AdminNav() {
  return (
    <ConsolePageRail>
      <div>
        <p className="mb-2 px-2 text-xs font-medium text-muted-foreground">系统设置</p>
        <nav className="grid gap-1" aria-label="系统设置分区">
          <AdminLink to="/admin" label="实例概览" exact />
          <AdminLink to="/admin/data-retention" label="数据生命周期" />
          <AdminLink to="/admin/audit" label="维护与审计" />
          <AdminLink to="/admin/object-storage" label="对象存储" />
        </nav>
      </div>
      <div>
        <p className="mb-2 px-2 text-xs font-medium text-muted-foreground">待开放</p>
        <div className="grid gap-1">
          {upcomingSections.map((section) => (
            <span
              key={section}
              className="flex min-h-10 items-center rounded-md px-3 text-sm text-muted-foreground/70"
              aria-disabled="true"
            >
              {section}
            </span>
          ))}
        </div>
      </div>
    </ConsolePageRail>
  );
}

function AdminLink({ to, label, exact = false }: { to: string; label: string; exact?: boolean }) {
  return (
    <Link
      to={to}
      activeOptions={{ exact }}
      className="flex min-h-10 items-center rounded-md px-3 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      activeProps={{ className: "bg-muted font-medium text-foreground" }}
    >
      {label}
    </Link>
  );
}
