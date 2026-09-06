import { expect, test } from "@playwright/test";
import { mockOpenRUM, projectId } from "./mockOpenRUM";

test("Alpha demo connects a behavior funnel to a mapped error source", async ({ page }) => {
  await mockOpenRUM(page, { projectExists: true });

  await page.goto(`/projects/${projectId}/analytics/funnels`);
  await expect(page.getByRole("heading", { name: "漏斗分析" })).toBeVisible();
  await page.getByRole("button", { name: "运行漏斗" }).click();
  await expect(page.getByRole("heading", { name: "转化结果" })).toBeVisible();
  await expect(page.getByText("24 个起始会话")).toBeVisible();
  await expect(page.getByText("15 个会话")).toBeVisible();

  await page.goto(`/projects/${projectId}/sessions`);
  await page.getByRole("button", { name: /visitor_7fa2/ }).click();
  await page.getByRole("link", { name: "查看 Issue 与源码" }).first().click();
  await expect(
    page.getByRole("heading", { name: "TypeError: checkout amount is undefined" }),
  ).toBeVisible();
  await expect(page.getByText("已映射")).toBeVisible();
  await page.getByRole("tab", { name: "映射源码" }).click();
  await expect(page.getByText("src/checkout/submit.ts:4:11")).toBeVisible();
});
