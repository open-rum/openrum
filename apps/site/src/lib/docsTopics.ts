import type { StarlightRouteData } from "@astrojs/starlight/route-data";

// The documentation taxonomy is declared once, in the Starlight `sidebar` config.
// The header reads its top-level tabs from there and the sidebar scopes itself to the
// tab the reader is inside, so neither component keeps a second copy of the tree and
// the localized group labels come along for free.

export type SidebarEntry = StarlightRouteData["sidebar"][number];
export type SidebarLink = Extract<SidebarEntry, { type: "link" }>;
export type SidebarGroup = Extract<SidebarEntry, { type: "group" }>;

export interface Topic {
  label: string;
  href: string;
  isCurrent: boolean;
  entries: SidebarGroup["entries"];
}

export interface Crumb {
  label: string;
  href?: string;
}

function descendants(entries: SidebarGroup["entries"]): SidebarLink[] {
  return entries.flatMap((entry) => (entry.type === "link" ? [entry] : descendants(entry.entries)));
}

/**
 * The top-level sidebar groups, presented as the header's primary navigation. A group
 * with no reachable page is dropped rather than rendered as a dead tab.
 */
export function topics(sidebar: SidebarEntry[]): Topic[] {
  return sidebar.flatMap<Topic>((entry) => {
    if (entry.type !== "group") return [];
    const pages = descendants(entry.entries);
    const landing = pages[0];
    if (!landing) return [];
    return [
      {
        label: entry.label,
        href: landing.href,
        isCurrent: pages.some((page) => page.isCurrent),
        entries: entry.entries,
      },
    ];
  });
}

export function activeTopic(sidebar: SidebarEntry[]): Topic | undefined {
  return topics(sidebar).find((topic) => topic.isCurrent);
}

/**
 * Group labels from the active tab down to the current page, so the reader can tell
 * which of the three levels they are standing on.
 */
export function trail(entries: SidebarGroup["entries"]): Crumb[] {
  for (const entry of entries) {
    if (entry.type === "link") {
      if (entry.isCurrent) return [{ label: entry.label, href: entry.href }];
      continue;
    }
    const nested = trail(entry.entries);
    if (nested.length > 0) return [{ label: entry.label }, ...nested];
  }
  return [];
}
