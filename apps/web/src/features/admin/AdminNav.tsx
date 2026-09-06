import { Link } from "@tanstack/react-router";

const upcomingSections = ["认证与访问", "通知"];

export function AdminNav() {
  return (
    <nav className="mb-6 flex gap-1 overflow-x-auto border-b" aria-label="系统管理分区">
      <Link
        to="/admin"
        activeOptions={{ exact: true }}
        className="whitespace-nowrap px-3 py-2 text-sm text-muted-foreground"
        activeProps={{ className: "border-b-2 border-primary font-medium text-foreground" }}
      >
        实例概览
      </Link>
      <Link
        to="/admin/data-retention"
        className="whitespace-nowrap px-3 py-2 text-sm text-muted-foreground"
        activeProps={{ className: "border-b-2 border-primary font-medium text-foreground" }}
      >
        数据生命周期
      </Link>
      <Link
        to="/admin/audit"
        className="whitespace-nowrap px-3 py-2 text-sm text-muted-foreground"
        activeProps={{ className: "border-b-2 border-primary font-medium text-foreground" }}
      >
        维护与审计
      </Link>
      <Link
        to="/admin/object-storage"
        className="whitespace-nowrap px-3 py-2 text-sm text-muted-foreground"
        activeProps={{ className: "border-b-2 border-primary font-medium text-foreground" }}
      >
        对象存储
      </Link>
      {upcomingSections.map((section) => (
        <span
          key={section}
          className="whitespace-nowrap px-3 py-2 text-sm text-muted-foreground"
          aria-disabled="true"
        >
          {section}
        </span>
      ))}
    </nav>
  );
}
