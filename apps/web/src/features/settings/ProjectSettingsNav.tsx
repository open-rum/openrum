import { Link } from "@tanstack/react-router";

// Kept in one place because both settings pages render the same nav, and a
// section added to only one of them is invisible from the other.
const sections = [
  { to: "/projects/$projectId/settings", label: "常规", exact: true },
  { to: "/projects/$projectId/settings/keys", label: "Write Keys", exact: false },
  { to: "/projects/$projectId/settings/filters", label: "入站过滤", exact: false },
  { to: "/projects/$projectId/settings/url-rules", label: "URL 归一化", exact: false },
  { to: "/projects/$projectId/settings/scrubbing", label: "脱敏", exact: false },
  { to: "/projects/$projectId/settings/quota", label: "配额", exact: false },
  // Alerts live outside the settings layout and keep their own page, so this
  // link leaves the section rather than switching a pane inside it. It is here
  // because "where do I configure this project" is the question the nav
  // answers, and the answer for alerting was previously nowhere.
  { to: "/projects/$projectId/alerts", label: "告警", exact: false },
] as const;

export function ProjectSettingsNav({ projectId }: { projectId: string }) {
  return (
    <nav className="flex gap-1 overflow-x-auto md:flex-col" aria-label="项目设置分区">
      {sections.map((section) => (
        <Link
          key={section.to}
          to={section.to}
          params={{ projectId }}
          activeOptions={section.exact ? { exact: true } : undefined}
          // Colours are split across active/inactive rather than overridden,
          // because two competing `text-*` utilities are decided by the order
          // Tailwind emits them in, not by which one is on the active link.
          className="whitespace-nowrap rounded-md px-3 py-2 text-sm"
          // `--ds-primary` is the same light lemon fill in both themes and is
          // paired with black text, so it is unreadable as a label colour.
          // `--ds-brand` is the theme-aware pair the app sidebar already uses.
          activeProps={{ className: "bg-[var(--ds-brand-soft)] font-medium text-[var(--brand)]" }}
          inactiveProps={{
            className: "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
          }}
        >
          {section.label}
        </Link>
      ))}
    </nav>
  );
}
