import { expect, test } from "@playwright/test";
import { mockOpenRUM, projectId } from "./mockOpenRUM";

test("breach creates one actionable notification with exact diagnostic context", async ({
  page,
}) => {
  await mockOpenRUM(page, { projectExists: true });
  await page.goto("/alerts");
  await expect(page.getByRole("heading", { name: "告警中心" })).toBeVisible();
  await page.getByRole("button", { name: "启用规则" }).first().click();
  await expect(page.getByText("错误率突增", { exact: true }).last()).toBeVisible();
  await expect(page.getByText("同一规则窗口只显示一条通知")).toBeVisible();
  const diagnostic = page.getByRole("link", { name: /进入诊断/ });
  await expect(diagnostic).toHaveCount(1);
  const href = await diagnostic.getAttribute("href");
  expect(href).toContain(`project=${projectId}`);
  expect(href).toContain("environment=production");
  expect(href).toContain("from=");
  expect(href).toContain("to=");
  if (process.env.OPENRUM_ALERTS_SCREENSHOT)
    await page.screenshot({ path: process.env.OPENRUM_ALERTS_SCREENSHOT, fullPage: true });
});

test("webhook channel is saved without echoing its secret", async ({ page }) => {
  await mockOpenRUM(page, { projectExists: true });
  await page.goto("/settings/channels");
  await page.getByLabel("名称").fill("研发值班");
  await page.getByLabel("HTTPS URL").fill("https://hooks.example.com/openrum");
  await page.getByLabel("签名密钥").fill("0123456789abcdef");
  await page.getByRole("button", { name: "保存渠道" }).click();
  await expect(page.getByRole("status")).toContainText("已加密保存");
  await expect(page.getByText("研发值班")).toBeVisible();
  await expect(page.locator("body")).not.toContainText("0123456789abcdef");
});
