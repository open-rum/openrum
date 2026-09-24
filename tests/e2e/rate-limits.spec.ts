import { expect, test } from "@playwright/test";

import { mockOpenRUM, projectId } from "./mockOpenRUM";

const rateLimitPath = `/settings/project/${projectId}/quota`;

test("an owner can validate and save a Project Rate Limit override", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await mockOpenRUM(page, { projectExists: true, role: "owner" });
  await page.goto(rateLimitPath);

  await expect(page).toHaveURL(new RegExp(`${rateLimitPath}$`));
  await expect(page.locator("vite-error-overlay")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "速率限制" })).toBeVisible();
  await expect(page.getByRole("region", { name: "当前速率限制摘要" })).toContainText(
    "5,000 请求/秒",
  );

  await page.getByRole("radio", { name: "Project 自定义" }).click();
  const limit = page.getByLabel("每秒请求上限");
  await expect(limit).toHaveValue("5000");

  await limit.fill("0");
  await expect(page.getByText("请输入 1–1,000,000 之间的整数。")).toBeVisible();
  await expect(page.getByRole("button", { name: "保存速率限制" })).toBeDisabled();

  await limit.fill("7200");
  await page.getByRole("radio", { name: /按调用方降采样/ }).click();
  await page.getByRole("button", { name: "保存速率限制" }).click();
  await expect(page.getByRole("status")).toContainText("已保存");
  await expect(page.getByRole("region", { name: "当前速率限制摘要" })).toContainText(
    "7,200 请求/秒",
  );

  await page.reload();
  await expect(page.getByLabel("每秒请求上限")).toHaveValue("7200");
  await expect(page.getByRole("radio", { name: /按调用方降采样/ })).toHaveAttribute(
    "data-state",
    "on",
  );
  expect(consoleErrors).toEqual([]);
});

test("a viewer can inspect the effective limit but cannot change it", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockOpenRUM(page, { projectExists: true, role: "viewer" });
  await page.goto(rateLimitPath);

  await expect(page.getByText("当前权限为只读")).toBeVisible();
  await expect(page.getByRole("radio", { name: "Project 自定义" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "保存速率限制" })).toBeDisabled();
});
