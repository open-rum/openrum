import { expect, test } from "@playwright/test";
import { mockOpenRUM } from "./mockOpenRUM";

test("performance list exposes low samples and drills into distributions", async ({ page }) => {
  await mockOpenRUM(page, { projectExists: true });
  await page.goto("/performance");
  await expect(page.getByRole("heading", { name: "真实用户性能" })).toBeVisible();
  await expect(page.locator(".performance-page")).toHaveCSS("max-width", "none");
  await expect(page.getByRole("img", { name: "LCP P75 日期趋势" })).toBeVisible();
  await expect(page.getByRole("img", { name: "INP P75 日期趋势" })).toBeVisible();
  await expect(page.getByRole("img", { name: "CLS P75 日期趋势" })).toBeVisible();
  await expect(page.locator(".performance-metric-grid .recharts-line-curve")).toHaveCount(3);
  await expect(page.getByRole("region", { name: "Route 性能列表" })).toBeVisible();
  await page.getByRole("button", { name: "INP" }).click();
  await expect(page).toHaveURL(/metric=INP/);
  await expect(page.getByText("数据不足").first()).toBeVisible();
  await page
    .getByRole("region", { name: "Route 性能列表" })
    .getByText("/checkout", { exact: true })
    .click();
  await expect(page).toHaveURL(/route=%2Fcheckout/);
  await expect(page.getByRole("heading", { name: "/checkout" })).toBeVisible();
  await expect(page.getByLabel("INP 样本分布")).toBeVisible();
  await expect(page.getByText("4210 ms")).toBeVisible();
  if (process.env.OPENRUM_PERFORMANCE_SCREENSHOT)
    await page.screenshot({ path: process.env.OPENRUM_PERFORMANCE_SCREENSHOT, fullPage: true });
});

test("performance renders empty and bounded error states", async ({ page }) => {
  await mockOpenRUM(page, { projectExists: true, performanceState: "empty" });
  await page.goto("/performance");
  await expect(page.getByText("当前范围没有性能样本")).toBeVisible();

  await page.unrouteAll({ behavior: "wait" });
  await mockOpenRUM(page, { projectExists: true, performanceState: "error" });
  await page.reload();
  await expect(page.getByText("无法加载性能数据")).toBeVisible();
  await expect(page.locator("body")).not.toContainText("clickhouse");
});
