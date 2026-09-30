import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { mockOpenRUM } from "./mockOpenRUM";

test("login methods remain usable in light, dark and narrow layouts", async ({ page }) => {
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/v1/setup/status") return route.fulfill({ json: { initialized: true } });
    if (path === "/api/v1/auth/me")
      return route.fulfill({ status: 401, json: { error: { code: "UNAUTHENTICATED" } } });
    if (path === "/api/v1/auth/methods")
      return route.fulfill({
        json: {
          local: true,
          providers: [
            { id: "google", kind: "google", label: "Google" },
            { id: "github", kind: "github", label: "GitHub" },
            { id: "ldap", kind: "ldap", label: "公司目录" },
            { id: "company", kind: "oidc", label: "企业 SSO" },
          ],
        },
      });
    if (path === "/api/v1/auth/providers/ldap/ldap/login")
      return route.fulfill({
        status: 401,
        json: {
          error: { code: "INVALID_CREDENTIALS", message: "Directory credentials are invalid." },
        },
      });
    return route.fulfill({ status: 404, json: {} });
  });
  await page.goto("/login?returnTo=%2Fprojects%2Fexample");
  for (const name of ["Google", "GitHub", "公司目录", "企业 SSO"]) {
    await expect(page.getByRole("button", { name: `使用 ${name} 登录` })).toBeVisible();
  }
  await expect(page.getByRole("form", { name: "登录 OpenRUM" })).toBeVisible();
  if (process.env.OPENRUM_AUTH_LIGHT)
    await page.screenshot({ path: process.env.OPENRUM_AUTH_LIGHT, fullPage: true });
  await page.getByRole("button", { name: "使用 公司目录 登录" }).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("textbox", { name: "目录用户名" }).fill("alice");
  await page.getByLabel("目录密码").fill("incorrect-password");
  await page
    .getByRole("form", { name: "公司目录 登录" })
    .getByRole("button", { name: "登录" })
    .click();
  await expect(page.getByText("目录用户名或密码不正确。", { exact: true })).toBeVisible();
  const accessibility = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(accessibility.violations.filter((item) => item.impact === "critical")).toEqual([]);

  await page.getByRole("button", { name: "切换至暗色模式" }).click();
  await expect(page.locator("html[data-theme='dark']")).toHaveCount(1);
  await page.waitForTimeout(250);
  if (process.env.OPENRUM_AUTH_DARK)
    await page.screenshot({ path: process.env.OPENRUM_AUTH_DARK, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: "使用 Google 登录" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.waitForTimeout(250);
  if (process.env.OPENRUM_AUTH_MOBILE)
    await page.screenshot({ path: process.env.OPENRUM_AUTH_MOBILE, fullPage: true });
});

test("pending users only see status and sign-out", async ({ page }) => {
  await page.route("**/api/v1/auth/me", (route) =>
    route.fulfill({
      json: {
        userId: "pending",
        email: "new@example.test",
        displayName: "New",
        accessStatus: "pending",
        hasPassword: false,
      },
    }),
  );
  await page.goto("/awaiting-access?returnTo=%2Fprojects%2Fexample");
  await expect(page.getByRole("heading", { name: "等待组织授权" })).toBeVisible();
  await expect(page.getByText(/new@example.test/)).toBeVisible();
  await expect(page.getByRole("button", { name: "退出登录" })).toBeVisible();
  await expect(page.getByRole("link", { name: "创建组织" })).toHaveCount(0);
});

test("Owner settings explain the master key prerequisite", async ({ page }) => {
  await mockOpenRUM(page, { projectExists: true, instanceRole: "instance_owner" });
  await page.route("**/api/v1/admin/authentication", (route) =>
    route.fulfill({ json: { managedSecretsAvailable: false, providers: [] } }),
  );
  await page.goto("/settings/instance/authentication");
  await expect(page.getByRole("heading", { name: "认证与访问" })).toBeVisible();
  await expect(page.getByText("需要启用加密托管")).toBeVisible();
  for (const provider of ["Google", "GitHub", "LDAP", "通用 OIDC"]) {
    await expect(page.getByRole("button", { name: `选择 ${provider} 登录方式` })).toBeVisible();
  }
  await page.getByRole("button", { name: "选择 LDAP 登录方式" }).click();
  await expect(page.getByRole("button", { name: "选择 LDAP 登录方式" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByLabel("LDAP URL")).toBeVisible();
  await expect(page.getByRole("button", { name: "保存配置" })).toHaveCount(0);
  if (process.env.OPENRUM_AUTH_SETTINGS_DESKTOP)
    await page.screenshot({ path: process.env.OPENRUM_AUTH_SETTINGS_DESKTOP, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  if (process.env.OPENRUM_AUTH_SETTINGS)
    await page.screenshot({ path: process.env.OPENRUM_AUTH_SETTINGS, fullPage: true });
});
