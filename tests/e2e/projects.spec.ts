import { expect, test } from "@playwright/test";
import { mockOpenRUM, secondProjectId } from "./mockOpenRUM";

test("a user with no projects starts in project creation", async ({ page }) => {
  await mockOpenRUM(page);
  await page.goto("/");

  await expect(page).toHaveURL(/\/projects\/new$/);
  await expect(page.getByRole("heading", { name: "创建监控项目" })).toBeVisible();
});

test("a user can list, switch and restore projects", async ({ page }) => {
  await mockOpenRUM(page, { projectExists: true, projectCount: 2 });
  await page.goto("/projects");

  await expect(page.getByRole("heading", { name: "项目", exact: true })).toBeVisible();
  const projectList = page.getByLabel("项目列表");
  await expect(projectList.getByText("Magic Moment H5", { exact: true })).toBeVisible();
  await expect(projectList.getByText("Admin Console", { exact: true })).toBeVisible();

  await expect(page.getByRole("button", { name: /切换项目/ })).toHaveCount(0);
  await page.getByRole("link", { name: /OpenRUM，当前项目/ }).hover();
  const projectSwitcher = page.getByRole("navigation", { name: "切换项目" });
  await expect(projectSwitcher).toBeVisible();
  await projectSwitcher.getByRole("button", { name: /Admin Console/ }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${secondProjectId}/overview(?:\\?.*)?$`));
  await expect(page.getByText("Admin Console", { exact: true }).first()).toBeVisible();

  await page.goto("/");
  await expect(page).toHaveURL(new RegExp(`/projects/${secondProjectId}/overview(?:\\?.*)?$`));
});

test("collapsed sidebar stacks its expand control below the brand", async ({ page }) => {
  await mockOpenRUM(page, { projectExists: true });
  await page.goto("/projects");

  await page.getByRole("button", { name: "收起侧边栏" }).click();
  const shell = page.locator(".app-shell");
  const brand = page.locator(".brand");
  const expand = page.getByRole("button", { name: "展开侧边栏" });
  await expect(shell).toHaveAttribute("data-sidebar-state", "collapsed");

  await expect
    .poll(async () => {
      const [brandBox, expandBox] = await Promise.all([brand.boundingBox(), expand.boundingBox()]);
      if (!brandBox || !expandBox) return null;
      return {
        centerDelta: Math.abs(
          expandBox.x + expandBox.width / 2 - (brandBox.x + brandBox.width / 2),
        ),
        verticalGap: expandBox.y - (brandBox.y + brandBox.height),
      };
    })
    .toEqual({ centerDelta: 0, verticalGap: 4 });
});
