import { Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { BellRingIcon, ShieldCheckIcon, UserRoundIcon, UsersIcon } from "lucide-react";

import { ConsolePageRail } from "@/components/layout/ConsolePage";
import { sessionQueryOptions } from "@/lib/auth/session";
import { cn } from "@/lib/utils";

const items = [
  { label: "Account", to: "/account", icon: UserRoundIcon, exact: true },
  { label: "组织与成员", to: "/settings", icon: UsersIcon, exact: true },
  { label: "通知渠道", to: "/settings/channels", icon: BellRingIcon, exact: false },
] as const;

export function AccountSettingsNav() {
  const { data: user } = useSuspenseQuery(sessionQueryOptions());
  const navigationItems = user.instanceRole
    ? [...items, { label: "系统设置", to: "/admin", icon: ShieldCheckIcon, exact: false as const }]
    : items;
  return (
    <ConsolePageRail>
      <div>
        <p className="mb-2 px-2 text-xs font-medium text-muted-foreground">账户设置</p>
        <nav className="grid gap-1" aria-label="账户设置分区">
          {navigationItems.map(({ label, to, icon: Icon, exact }) => (
            <Link
              key={to}
              to={to}
              activeOptions={{ exact }}
              className={cn(
                "flex min-h-10 items-center gap-2 rounded-md px-3 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
              )}
              activeProps={{ className: "bg-muted font-medium text-foreground" }}
            >
              <Icon className="size-4" />
              {label}
            </Link>
          ))}
        </nav>
      </div>
    </ConsolePageRail>
  );
}
