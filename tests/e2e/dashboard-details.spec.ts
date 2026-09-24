import { expect, test, type Page } from "@playwright/test";
import type { OverviewResponse } from "../../apps/web/src/lib/api/client";
import { mockOpenRUM, overview, projectId } from "./mockOpenRUM";

async function setup(page: Page) {
  // Keep screenshots deterministic while exercising the reduced-motion preference.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await mockOpenRUM(page, { projectExists: true });
  const result: OverviewResponse = overview();
  result.comparison.previous = structuredClone(result.kpis);
  result.comparison.previous.pageViews.value = result.kpis.pageViews.value / 2;
  result.comparison.changes.pageViewsPercent = 100;
  result.comparison.changes.errorRatePoints = 0.5;
  result.comparison.previous.errorRate.value = result.kpis.errorRate.value! - 0.005;
  result.comparison.changes.apiFailureRatePoints = null;
  result.comparison.previous.apiFailureRate.value = null;
  result.comparison.changes.inpPercent = -8;
  result.kpis.cls.sufficient = false;
  result.freshness.stale = true;
  const requests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/v1/")) requests.push(`${request.method()} ${request.url()}`);
  });
  await page.route("**/api/v1/projects/*/overview/config", (route) =>
    route.fulfill({ json: { config: null, revision: 0, updatedAt: null } }),
  );
  await page.route(/\/api\/v1\/projects\/[^/]+\/overview\?/, (route) =>
    route.fulfill({ json: result }),
  );
  await page.goto(
    `/projects/${projectId}/overview?from=2026-09-02T00:00:00Z&to=2026-09-03T00:00:00Z`,
  );
  await expect(page.locator('[data-module-title="PV"] strong')).toHaveText("9900");
  return requests;
}

test("quiet cards expose semantic comparisons and keyboard-accessible details without more queries", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1350, height: 964 });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  const requests = await setup(page);
  const card = page.locator('[data-module-title="PV"]');
  const trigger = card.getByRole("button", { name: "PV 操作", exact: true });
  await expect(page.getByRole("button", { name: "刷新数据", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "编辑概览", exact: true })).toHaveText("");
  await expect(card.locator('[data-slot="card-description"]')).toHaveCount(0);
  await expect(card).not.toContainText("采集样本");
  await expect(card).not.toContainText("最近接收");
  await expect(page.getByText("查看数据表", { exact: true })).toHaveCount(0);
  await expect(card.locator('[data-slot="card-header"] .dashboard-comparison')).toHaveCount(0);
  await expect(card.locator('[data-slot="card-content"] .dashboard-comparison')).toHaveAttribute(
    "data-tone",
    "positive",
  );
  await expect(card.getByText("较上一周期", { exact: true })).toBeVisible();
  await expect(card.getByText("页面浏览次数", { exact: true })).toHaveCount(0);
  const valueBox = await card.locator("strong").boundingBox();
  const comparisonBox = await card.locator(".dashboard-comparison-row").boundingBox();
  expect(comparisonBox!.y).toBeGreaterThanOrEqual(valueBox!.y + valueBox!.height);
  expect(Math.abs(comparisonBox!.x - valueBox!.x)).toBeLessThan(1);
  await expect(page.locator('[data-module-title="错误率"] .dashboard-comparison')).toHaveAttribute(
    "data-tone",
    "negative",
  );
  await expect(page.locator('[data-module-title="INP P75"] .dashboard-comparison')).toHaveAttribute(
    "data-tone",
    "positive",
  );
  await expect(page.locator('[data-module-title="API 失败率"] .dashboard-comparison')).toHaveText(
    "无对比",
  );
  await expect(page.locator('[data-module-title="CLS P75"] .dashboard-comparison')).toHaveText(
    "样本不足",
  );
  await expect(trigger).toHaveCSS("opacity", "0");
  await card.hover();
  await expect(trigger).toHaveCSS("opacity", "1");
  await page.screenshot({ path: "/tmp/openrum-dashboard-cards-below-value.png" });
  await page.getByRole("heading", { level: 1 }).hover();
  await trigger.focus();
  await expect(trigger).toHaveCSS("opacity", "1");
  const queryCount = requests.length;
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menuitem", { name: "配置模块", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "保存概览", exact: true })).toHaveCount(0);
  await page.screenshot({ path: "/tmp/openrum-dashboard-hover-menu.png" });
  await page.getByRole("menuitem", { name: "详细", exact: true }).press("Enter");
  const dialog = page.getByRole("dialog", { name: "PV 详情", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "关闭详情" })).toBeFocused();
  await expect(dialog).toContainText("9,900 个采集样本");
  await expect(dialog).toContainText("数据延迟");
  await expect(dialog.getByRole("region", { name: "周期对比" })).toContainText("4,950");
  await expect(dialog).not.toHaveAttribute("data-card-motion");
  await expect(dialog.locator(".recharts-line-curve")).toHaveAttribute("d", /M/);
  await dialog.getByRole("tab", { name: "数据表", exact: true }).click();
  // The 24h / 5m fixture includes six populated buckets. Missing buckets now
  // remain explicit gaps across the full range, including in the exact-value table.
  await expect(dialog.getByRole("table", { name: "PV 数据表" }).getByRole("row")).toHaveCount(289);
  await dialog.getByRole("tab", { name: "趋势", exact: true }).click();
  await page.screenshot({ path: "/tmp/openrum-dashboard-details-dialog.png" });
  expect(requests.length).toBe(queryCount);
  expect(requests.filter((request) => request.startsWith("PUT"))).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await page.getByRole("button", { name: "编辑概览", exact: true }).click();
  await expect(page.getByRole("button", { name: "PV 操作", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "PV 详情", exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("trend cards put tables and threshold notes only inside the dialog", async ({ page }) => {
  await page.setViewportSize({ width: 1350, height: 964 });
  await setup(page);
  const card = page.locator('[data-module-title="LCP P75 趋势"]');
  await expect(card.getByRole("table")).toHaveCount(0);
  await expect(card).not.toContainText("参考线");
  await card.hover();
  await card.getByRole("button", { name: "LCP P75 趋势 操作", exact: true }).click();
  await page.getByRole("menuitem", { name: "详细", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "LCP P75 趋势 详情", exact: true });
  await dialog.getByRole("tab", { name: "数据表", exact: true }).click();
  await expect(dialog.getByRole("table", { name: "LCP P75 趋势 数据表" })).toContainText(
    "2,200 ms",
  );
  await expect(dialog).toContainText("参考线");
  await dialog.getByRole("button", { name: "关闭详情" }).click();
  await expect(dialog).toHaveCount(0);
});

test("mobile retains the details entry and a bounded scrollable dialog", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  const trigger = page.getByRole("button", { name: "PV 操作", exact: true });
  await expect(trigger).toHaveCSS("opacity", "1");
  await trigger.click();
  await page.getByRole("menuitem", { name: "详细", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "PV 详情", exact: true });
  await expect(dialog).toBeVisible();
  const bounds = await dialog.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(844);
  await dialog.getByRole("tab", { name: "数据表", exact: true }).click();
  await dialog.getByRole("table", { name: "PV 数据表" }).scrollIntoViewIfNeeded();
  await expect(dialog.getByRole("table", { name: "PV 数据表" })).toBeVisible();
  await page.screenshot({ path: "/tmp/openrum-dashboard-details-mobile.png" });
  await expect(dialog.getByRole("button", { name: "关闭详情" })).toBeInViewport();
  await dialog.getByRole("button", { name: "关闭详情" }).click();
  await expect(trigger).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("dark cards expose the menu and cancelling configuration does not start a draft", async ({
  page,
}) => {
  await setup(page);
  await page.getByRole("button", { name: "切换至暗色模式", exact: true }).click();
  const card = page.locator('[data-module-title="PV"]');
  await card.hover();
  await card.getByRole("button", { name: "PV 操作", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "详细", exact: true })).toBeVisible();
  await page.screenshot({ path: "/tmp/openrum-dashboard-hover-menu-dark.png" });
  await page.getByRole("menuitem", { name: "配置模块", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "配置模块", exact: true });
  await expect(editor.getByRole("textbox", { name: "标题", exact: true })).toHaveValue("PV");
  await editor.getByRole("button", { name: "取消", exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect(page.getByRole("button", { name: "保存概览", exact: true })).toHaveCount(0);
});

test("hover menu can edit a viewing dashboard without a prior edit-mode click", async ({
  page,
}) => {
  const requests = await setup(page);
  const trigger = page.getByRole("button", { name: "PV 操作", exact: true });
  await trigger.click();
  await page.getByRole("menuitem", { name: "复制模块", exact: true }).click();
  await expect(page.locator('[data-module-title="PV 副本"]')).toBeVisible();
  await expect(page.getByRole("button", { name: "保存概览", exact: true })).toBeEnabled();
  expect(requests.filter((request) => request.startsWith("PUT"))).toEqual([]);
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "放弃修改", exact: true })
    .click();
  await expect(page.locator('[data-module-title="PV 副本"]')).toHaveCount(0);
  await expect(page.getByRole("button", { name: "编辑概览", exact: true })).toBeVisible();
});
