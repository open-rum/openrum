import { expect, test } from "@playwright/test";
import { mockOpenRUM, projectId } from "./mockOpenRUM";

test("session exploration preserves context into issue and source", async ({ page }) => {
  await mockOpenRUM(page, { projectExists: true });
  await page.goto(`/projects/${projectId}/sessions`);

  await expect(page.getByRole("heading", { name: "会话" })).toBeVisible();
  await expect(page.getByText("错误会话")).toBeVisible();
  await page.getByRole("button", { name: /visitor_7fa2/ }).click();
  const issueEvidence = page.getByRole("link", { name: "查看 Issue 与源码" }).first();
  await expect(issueEvidence).toHaveAttribute("href", /from=.*to=/);
  await issueEvidence.click();

  await expect(
    page.getByRole("heading", { name: "TypeError: checkout amount is undefined" }),
  ).toBeVisible();
  await page.getByRole("tab", { name: /行为时间线/ }).click();
  await expect(page.getByText("点击提交订单")).toBeVisible();
  await expect(
    page.getByLabel("会话行为时间线").getByText("checkout amount is undefined", { exact: true }),
  ).toBeVisible();
});
