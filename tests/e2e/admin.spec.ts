import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { mockOpenRUM } from "./mockOpenRUM";

test("instance owner can inspect lifecycle and redacted audit data", async ({ page }) => {
  await mockOpenRUM(page, { projectExists: true, instanceRole: "instance_owner" });
  await page.goto("/admin/data-retention");
  await expect(page.getByRole("heading", { name: "数据生命周期" })).toBeVisible();
  await expect(page.getByText("Source Map", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Deployment", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "维护与审计" }).click();
  await expect(page.getByText("req-e2e")).toBeVisible();
  await expect(page.getByText(/top-secret|currentPassword|secretAccessKey/i)).toHaveCount(0);
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(results.violations.filter((item) => item.impact === "critical")).toEqual([]);
});

test("non-instance user is redirected away from direct admin URL", async ({ page }) => {
  await mockOpenRUM(page, { projectExists: true });
  await page.goto("/admin/object-storage");
  await expect(page).toHaveURL(/\/projects$/);
});

test("retention settings enforce bounds and reauthenticate before mutation", async ({ page }) => {
  await mockOpenRUM(page, { projectExists: true, instanceRole: "instance_owner" });
  const mutations: string[] = [];
  page.on("request", (request) => {
    if (request.method() !== "GET") mutations.push(new URL(request.url()).pathname);
  });
  await page.goto("/admin/data-retention");

  const rawDays = page.getByLabel("原始事件");
  const save = page.getByRole("button", { name: "保存默认策略" });
  await expect(save).toBeDisabled();
  await rawDays.fill("91");
  await expect(save).toBeDisabled();
  await rawDays.fill("30");
  await expect(save).toBeEnabled();
  await save.click();
  await page.getByLabel("当前密码").fill("OpenRUM-demo-2026!");
  await page.getByRole("button", { name: "验证并保存" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  expect(mutations).toContain("/api/v1/auth/reauthenticate");
  expect(mutations).toContain("/api/v1/admin/configuration");
  expect(mutations.indexOf("/api/v1/auth/reauthenticate")).toBeLessThan(
    mutations.indexOf("/api/v1/admin/configuration"),
  );
});
