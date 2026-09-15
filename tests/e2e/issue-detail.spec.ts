import { expect, test } from "@playwright/test";
import { mockOpenRUM, projectId } from "./mockOpenRUM";

test("issue investigation reaches mapped source and event context", async ({ page }) => {
  await mockOpenRUM(page, { projectExists: true });
  await page.goto(`/projects/${projectId}/issues/v1%3Ae2e-0`);

  await expect(
    page.getByRole("heading", { name: "TypeError: checkout amount is undefined" }),
  ).toBeVisible();
  await expect(page.getByText("src/checkout/submit.ts:4:11")).toBeVisible();
  await expect(page.getByText("return api.post('/orders', { amount });")).toBeVisible();
  const trend = page.getByLabel("错误事件与影响用户趋势");
  await trend.hover({ position: { x: 160, y: 100 } });
  await expect(page.getByText("Invalid time value", { exact: true })).toHaveCount(0);
  await expect(page.locator(".recharts-tooltip-wrapper")).toBeVisible();
  await expect(page.locator(".recharts-tooltip-wrapper")).toContainText(/09\/03/);
  await page.getByRole("heading", { name: "发生趋势" }).hover();
  await page.getByRole("tab", { name: /行为时间线/ }).click();
  await expect(page.getByText("点击提交订单")).toBeVisible();
  await page.getByRole("tab", { name: /相关 API/ }).click();
  await expect(page.getByText("https://api.example/orders")).toBeVisible();
  if (process.env.OPENRUM_DETAIL_LIGHT)
    await page.screenshot({ path: process.env.OPENRUM_DETAIL_LIGHT, fullPage: true });
  if (process.env.OPENRUM_DETAIL_DARK) {
    await page.getByRole("button", { name: /外观/ }).click();
    await page.getByRole("menuitemradio", { name: "暗色" }).click();
    await expect(page.locator("html")).toHaveClass(/dark/);
    await page.screenshot({ path: process.env.OPENRUM_DETAIL_DARK, fullPage: true });
  }
  if (process.env.OPENRUM_DETAIL_MOBILE) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: process.env.OPENRUM_DETAIL_MOBILE, fullPage: true });
  }
});

test("failed issue action rolls optimistic state back", async ({ page }) => {
  await mockOpenRUM(page, { projectExists: true, failIssuePatch: true });
  await page.goto(`/projects/${projectId}/issues/v1%3Ae2e-0`);
  await page.getByRole("button", { name: "标记解决" }).click();
  await expect(page.getByText("已解决", { exact: true })).toBeVisible();
  await expect(page.getByText("更新失败，已恢复原状态")).toBeVisible();
  await expect(page.getByText("待处理", { exact: true })).toBeVisible();
});
