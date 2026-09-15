import { expect, test } from "@playwright/test";
import { mockOpenRUM } from "./mockOpenRUM";

test("performance list exposes low samples and drills into distributions", async ({ page }) => {
  await mockOpenRUM(page, { projectExists: true });
  await page.goto("/performance");
  await expect(page.getByRole("heading", { name: "真实用户性能" })).toBeVisible();
  await expect(page.getByRole("button", { name: "刷新性能数据" })).toHaveCount(0);
  await expect(
    page.getByText("从整体体验到长尾延迟，按设备、国家和路由定位性能瓶颈。", { exact: true }),
  ).toHaveCount(0);
  await expect(page.locator('[data-console-page][data-width="fluid"]')).toBeVisible();
  await expect(page.getByRole("img", { name: "Web Vitals P75 真实值趋势" })).toBeVisible();
  await expect(page.getByText("性能评分", { exact: true })).toBeVisible();
  await expect(page.getByText("加权评分 · P75", { exact: true })).toBeVisible();
  await expect(page.locator(".performance-score-dial [data-score-metric]")).toHaveCount(5);
  await expect(page.locator(".performance-score-label")).toHaveText([
    "LCP",
    "FCP",
    "INP",
    "CLS",
    "TTFB",
  ]);
  await expect(page.locator(".performance-combined-chart .recharts-line-curve")).toHaveCount(5);
  await page.getByRole("combobox", { name: "统计分位数" }).click();
  await expect(page.getByRole("option")).toHaveText(["P50", "P75", "P95"]);
  await page.keyboard.press("Escape");
  await expect(
    page.locator('.performance-combined-card [data-slot="card-content"] .performance-trend-legend'),
  ).toBeVisible();
  await expect(page.locator('.performance-combined-card [data-slot="card-footer"]')).toHaveCount(0);
  await expect(page.getByRole("button", { name: "LCP 趋势", exact: true })).toHaveCSS(
    "font-size",
    "12px",
  );
  await expect(page.getByText("用于路由排序与分布分析")).toHaveCount(0);
  await expect(page.locator(".performance-summary-stats .performance-metric-card")).toHaveCount(5);
  await expect(page.getByRole("region", { name: "Route 性能列表" })).toBeVisible();
  await page.getByRole("combobox", { name: "路由排序指标" }).click();
  await page.getByRole("option", { name: "INP", exact: true }).click();
  await expect(page).toHaveURL(/metric=INP/);
  await expect(page.getByText("样本不足").first()).toBeVisible();
  await page
    .getByRole("region", { name: "Route 性能列表" })
    .getByText("/checkout", { exact: true })
    .click();
  await expect(page).toHaveURL(/route=%2Fcheckout/);
  await expect(page.getByRole("heading", { name: "/checkout" })).toBeVisible();
  await expect(page.getByLabel("INP 样本分布")).toBeVisible();
  await expect(page.getByText("4210 ms")).toBeVisible();
  await page.getByRole("radio", { name: "TTFB", exact: true }).click();
  await expect(page).toHaveURL(/metric=TTFB/);
  await expect(page.getByLabel("TTFB 样本分布")).toBeVisible();
  await page.getByRole("combobox", { name: "统计分位数" }).click();
  await page.getByRole("option", { name: "P50", exact: true }).click();
  await expect(page.getByLabel("TTFB P50 日期趋势")).toBeVisible();
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
