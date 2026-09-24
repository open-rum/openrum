import { expect, test } from "@playwright/test";
import { mockOpenRUM, projectId } from "./mockOpenRUM";

test("event filters use the shared search composer and URL-backed tokens", async ({ page }) => {
  await mockOpenRUM(page, { projectExists: true });
  await page.goto(`/projects/${projectId}/events`);
  await expect(page.getByRole("heading", { name: "事件管理与探索" })).toBeVisible();

  await page.keyboard.press("/");
  const search = page.getByRole("textbox", { name: "搜索事件或添加筛选条件" });
  await expect(search).toBeFocused();
  await page.getByRole("button", { name: /^事件 / }).click();
  await page.getByRole("button", { name: "全部点击", exact: true }).click();

  await expect(page).toHaveURL(/eventKind=click/);
  await expect(page.getByText("事件：全部点击")).toBeVisible();
  await expect(page.getByRole("combobox", { name: "行为事件" })).toHaveCount(0);
});

test("an event sample opens its complete session with the selected event anchored", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1024 });
  await mockOpenRUM(page, { projectExists: true });

  await page.goto(`/projects/${projectId}/events?eventKind=click&eventName=click`);
  await expect(page.getByRole("heading", { name: "原始样本" })).toBeVisible();
  await page
    .getByRole("row", { name: /checkout/ })
    .last()
    .click();

  await expect(page.getByRole("heading", { name: "完整会话时间线" })).toBeVisible();
  await expect(page.getByText("3 个事件")).toBeVisible();
  const current = page.getByRole("listitem").filter({ hasText: "当前事件" });
  await expect(current).toBeVisible();
  await expect(current).toContainText("元素点击");
  await expect(current).toHaveAttribute("aria-current", "true");

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("heading", { name: "完整会话时间线" })).toBeVisible();
  const drawer = page.locator('[data-slot="drawer-content"]');
  const bounds = await drawer.boundingBox();
  expect(bounds?.x).toBeGreaterThanOrEqual(0);
  expect(bounds?.width).toBeLessThanOrEqual(391);
});
