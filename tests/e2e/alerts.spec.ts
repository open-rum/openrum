import { expect, test } from "@playwright/test";
import { mockOpenRUM, projectId } from "./mockOpenRUM";

test("a template opens the editor and the saved rule's notification keeps its diagnostic context", async ({
  page,
}) => {
  await mockOpenRUM(page, { projectExists: true });
  await page.goto(`/projects/${projectId}/alerts`);
  await expect(page.getByRole("heading", { name: "告警", exact: true })).toBeVisible();
  await page.getByRole("button", { name: /错误率突增/ }).click();
  const editor = page.getByRole("dialog", { name: "新建告警规则" });
  await expect(editor.getByLabel("规则名称")).toHaveValue("错误率突增");
  await expect(editor).toContainText("只在控制台记录");
  await editor.getByRole("button", { name: "创建规则" }).click();
  await expect(page.getByRole("status")).toContainText("已创建规则「错误率突增」");
  await expect(page.getByRole("cell", { name: /错误率 ≥ 2% · 最近 5 分钟/ })).toBeVisible();

  await page.getByRole("tab", { name: /通知记录/ }).click();
  await expect(page).toHaveURL(/tab=history/);
  const diagnostic = page.getByRole("link", { name: /进入诊断/ });
  await expect(diagnostic).toHaveCount(1);
  const href = await diagnostic.getAttribute("href");
  expect(href).toContain(`/projects/${projectId}/issues`);
  expect(href).toContain("environment=production");
  expect(href).toContain("from=");
  expect(href).toContain("to=");
  if (process.env.OPENRUM_ALERTS_SCREENSHOT)
    await page.screenshot({ path: process.env.OPENRUM_ALERTS_SCREENSHOT, fullPage: true });
});

test("a Feishu channel is saved, tested and never echoes its secrets", async ({ page }) => {
  await mockOpenRUM(page, { projectExists: true });
  await page.goto("/settings/org/channels");
  await expect(page.getByRole("button", { name: /钉钉/ })).toBeDisabled();
  await expect(page.getByRole("button", { name: /Slack/ })).toBeDisabled();
  await page.getByRole("button", { name: /飞书/ }).click();
  const dialog = page.getByRole("dialog", { name: /添加飞书渠道/ });
  await dialog.getByLabel("名称").fill("飞书·前端值班群");
  const hook = "https://open.feishu.cn/open-apis/bot/v2/hook/0f1e2d3c";
  await dialog.getByLabel("Webhook 地址").fill(hook);
  await dialog.getByLabel(/签名校验密钥/).fill("feishu-signing-secret");
  await dialog.getByRole("button", { name: "保存渠道" }).click();
  await expect(page.getByRole("status").first()).toContainText("测试消息已送达");
  await expect(page.getByText("飞书·前端值班群", { exact: true })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("feishu-signing-secret");
  await expect(page.locator("body")).not.toContainText(hook);
});
