import type { Project } from "@/lib/api/projects";

const recentProjectPrefix = "openrum:recent-project:";

export function recentProjectStorageKey(organizationId: string) {
  return `${recentProjectPrefix}${organizationId}`;
}

export function rememberProject(project: Pick<Project, "id" | "organizationId">) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(recentProjectStorageKey(project.organizationId), project.id);
  } catch {
    // Storage can be unavailable in hardened/private browser contexts.
  }
}

export function readRecentProjectId(organizationId: string) {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(recentProjectStorageKey(organizationId));
  } catch {
    return null;
  }
}

export function projectIdFromPathname(pathname: string) {
  const match = pathname.match(/^\/projects\/([^/]+)(?:\/|$)/);
  return match ? decodeURIComponent(match[1]) : undefined;
}

export function selectProject(
  projects: Project[],
  organizationId: string,
  requestedProjectId?: string,
) {
  const requested = projects.find((project) => project.id === requestedProjectId);
  if (requested) return requested;
  const recentProjectId = readRecentProjectId(organizationId);
  return projects.find((project) => project.id === recentProjectId) ?? projects[0];
}
