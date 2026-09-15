import { Link } from "@tanstack/react-router";

import { ConsolePageRail } from "@/components/layout/ConsolePage";

const groups = [
  {
    label: "基础",
    items: [
      { to: "/projects/$projectId/settings", label: "常规", exact: true },
      { to: "/projects/$projectId/onboarding", label: "接入", exact: false },
      { to: "/projects/$projectId/settings/keys", label: "客户端 DSN", exact: false },
    ],
  },
  {
    label: "数据治理",
    items: [
      { to: "/projects/$projectId/settings/filters", label: "入站过滤", exact: false },
      { to: "/projects/$projectId/settings/url-rules", label: "URL 归一化", exact: false },
      { to: "/projects/$projectId/settings/scrubbing", label: "脱敏", exact: false },
    ],
  },
  {
    label: "运行管理",
    items: [
      { to: "/projects/$projectId/releases", label: "发布", exact: false },
      { to: "/projects/$projectId/usage", label: "用量", exact: false },
      { to: "/projects/$projectId/settings/quota", label: "配额", exact: false },
    ],
  },
] as const;

export function ProjectSettingsNav({ projectId }: { projectId: string }) {
  return (
    <ConsolePageRail>
      {groups.map((group) => (
        <section key={group.label} className="flex flex-col gap-1">
          <h2 className="px-3 pb-1 text-xs font-medium text-muted-foreground">{group.label}</h2>
          <nav className="flex flex-col gap-1" aria-label={`项目设置 · ${group.label}`}>
            {group.items.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                params={{ projectId }}
                activeOptions={item.exact ? { exact: true } : undefined}
                className="rounded-md px-3 py-2 text-sm whitespace-nowrap"
                activeProps={{
                  className: "bg-accent font-medium text-accent-foreground",
                }}
                inactiveProps={{
                  className: "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                }}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </section>
      ))}

      {import.meta.env.DEV ? (
        <section className="flex flex-col gap-1">
          <h2 className="px-3 pb-1 text-xs font-medium text-muted-foreground">开发工具</h2>
          <nav className="flex flex-col gap-1" aria-label="项目设置 · 开发工具">
            <Link
              to="/projects/$projectId/dev-data"
              params={{ projectId }}
              className="rounded-md px-3 py-2 text-sm whitespace-nowrap"
              activeProps={{
                className: "bg-accent font-medium text-accent-foreground",
              }}
              inactiveProps={{
                className: "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
              }}
            >
              造数据
            </Link>
          </nav>
        </section>
      ) : null}
    </ConsolePageRail>
  );
}
