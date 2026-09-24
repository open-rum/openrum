// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import type { Project } from "@/lib/api/projects";
import {
  readRecentProjectId,
  projectIdFromPathname,
  recentProjectStorageKey,
  rememberProject,
  selectProject,
} from "./currentProject";

const projects = [
  { id: "project-a", organizationId: "org-a", name: "A" },
  { id: "project-b", organizationId: "org-a", name: "B" },
] as Project[];

describe("current project selection", () => {
  beforeEach(() => window.localStorage.clear());

  it("prefers a project requested by the route", () => {
    rememberProject(projects[0]);
    expect(selectProject(projects, "org-a", "project-b")?.id).toBe("project-b");
  });

  it("restores the recent project and falls back to the first accessible project", () => {
    window.localStorage.setItem(recentProjectStorageKey("org-a"), "project-b");
    expect(selectProject(projects, "org-a")?.id).toBe("project-b");
    window.localStorage.setItem(recentProjectStorageKey("org-a"), "deleted-project");
    expect(selectProject(projects, "org-a")?.id).toBe("project-a");
  });

  it("persists the recent project by organization", () => {
    rememberProject(projects[1]);
    expect(readRecentProjectId("org-a")).toBe("project-b");
  });

  it("reads a project id only from a project-scoped route", () => {
    expect(projectIdFromPathname("/projects/project-b/issues")).toBe("project-b");
    expect(projectIdFromPathname("/settings/project/project-b/usage")).toBe("project-b");
    expect(projectIdFromPathname("/issues")).toBeUndefined();
  });
});
