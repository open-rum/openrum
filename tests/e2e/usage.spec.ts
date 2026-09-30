import { expect, test } from "@playwright/test";
import { mockOpenRUM, projectId } from "./mockOpenRUM";

test("admin previews and saves sampling changes", async ({ page }) => {
  await mockOpenRUM(page, { projectExists: true, role: "admin" });
  await page.goto(`/settings/project/${projectId}/sampling`);
  await expect(page.getByRole("heading", { name: "采样配置" })).toBeVisible();
  if (process.env.OPENRUM_USAGE_SCREENSHOT)
    await page.screenshot({ path: process.env.OPENRUM_USAGE_SCREENSHOT, fullPage: true });
  const eventRate = page.getByRole("slider", { name: "页面、性能与自定义事件采样率" });
  for (let step = 0; step < 6; step += 1) await eventRate.press("PageDown");
  await expect(page.getByText("保存前预览")).toBeVisible();
  await page.getByRole("button", { name: "保存采样配置" }).click();
  await expect(page.getByRole("status")).toContainText("已保存");
  await expect(eventRate).toHaveAttribute("aria-valuenow", "40");
});

test("failed save rolls back and members remain read-only", async ({ page }) => {
  await mockOpenRUM(page, { projectExists: true, role: "owner", failProjectPatch: true });
  await page.goto(`/settings/project/${projectId}/sampling`);
  const eventRate = page.getByRole("slider", { name: "页面、性能与自定义事件采样率" });
  for (let step = 0; step < 7; step += 1) await eventRate.press("PageDown");
  await page.getByRole("button", { name: "保存采样配置" }).click();
  await expect(page.getByRole("alert")).toContainText("已回滚");
  await expect(eventRate).toHaveAttribute("aria-valuenow", "100");

  await page.unrouteAll();
  await mockOpenRUM(page, { projectExists: true, role: "member" });
  await page.reload();
  await expect(page.getByText("Member / Viewer 仅可查看")).toBeVisible();
  await expect(page.getByRole("button", { name: "保存采样配置" })).toBeDisabled();
});
