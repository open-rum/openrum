// @vitest-environment jsdom
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { Project } from "@/lib/api/projects";
import { SettingsNav } from "./SettingsNav";

afterEach(cleanup);

const project = { id: "p1", name: "Web" } as Project;

async function mount(path: string) {
  const router = createRouter({
    routeTree: createRootRoute({
      component: () => (
        <SettingsNav
          organizationName="Org"
          project={project}
          showInstance={false}
          instanceOwner={false}
        />
      ),
    }),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(<RouterProvider router={router} />);
  return within(await screen.findByRole("navigation", { name: "设置 · 项目" }));
}

describe("project settings navigation", () => {
  it("lists Source Map after 接入指引, as a project setting", async () => {
    const nav = await mount("/settings/project/p1/general");
    const labels = nav.getAllByRole("link").map((link) => link.textContent?.trim());
    const project = labels.indexOf("接入指引");
    expect(project).toBeGreaterThan(-1);
    expect(labels[project + 1]).toBe("Source Map");
    expect(nav.getByRole("link", { name: "Source Map" }).getAttribute("href")).toBe(
      "/settings/project/p1/sourcemaps",
    );
  });

  it("marks Source Map as the current page on its own address", async () => {
    const nav = await mount("/settings/project/p1/sourcemaps");
    expect(nav.getByRole("link", { name: "Source Map" }).className).toContain("is-active");
    expect(nav.getByRole("link", { name: "接入指引" }).className).not.toContain("is-active");
  });
});
