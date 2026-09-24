import { expect, test } from "@playwright/test";
import { mockOpenRUM } from "./mockOpenRUM";

test("issues filters, rows and themes remain usable", async ({ page }) => {
  await mockOpenRUM(page, { projectExists: true });
  await page.goto("/issues");
  await expect(page.getByRole("heading", { name: "错误问题" })).toBeVisible();
  await expect(page.getByRole("region", { name: "错误问题列表" })).toBeVisible();
  await expect(page.getByText("TypeError: checkout amount is undefined")).toBeVisible();

  const rows = page.locator("[data-issue-row]");
  await rows.first().focus();
  await rows.first().press("ArrowDown");
  await expect(rows.nth(1)).toBeFocused();

  await page.getByRole("combobox", { name: "问题状态" }).click();
  await page.getByRole("option", { name: "待处理" }).click();
  await expect(page).toHaveURL(/status=unresolved/);
  const search = page.getByRole("textbox", { name: "搜索错误或添加筛选条件" });
  await search.fill("checkout");
  await search.press("Enter");
  await expect(rows).toHaveCount(1);
  await search.fill("no-match");
  await search.press("Enter");
  await expect(page.getByText("当前范围没有匹配的问题")).toBeVisible();
  await page.getByRole("button", { name: "清除筛选" }).click();
  await expect(rows).toHaveCount(3);

  if (process.env.OPENRUM_ISSUES_LIGHT)
    await page.screenshot({ path: process.env.OPENRUM_ISSUES_LIGHT, fullPage: true });
  await expect(
    page.locator("#app-sidebar").getByRole("button", { name: /切换至.+色模式/ }),
  ).toHaveCount(0);
  const themeToggle = page
    .getByRole("region", { name: "应用状态栏" })
    .getByRole("button", { name: "切换至暗色模式" });
  await expect(themeToggle).toHaveAttribute("data-variant", "ghost");
  await themeToggle.click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  const darkForeground = await page
    .locator("body")
    .evaluate((element) => getComputedStyle(element).color);
  await expect(page.getByRole("combobox", { name: "问题状态" })).toHaveCSS("color", darkForeground);
  if (process.env.OPENRUM_ISSUES_DARK)
    await page.screenshot({ path: process.env.OPENRUM_ISSUES_DARK, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("heading", { name: "错误问题" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "问题状态" })).toBeVisible();
  if (process.env.OPENRUM_ISSUES_MOBILE)
    await page.screenshot({ path: process.env.OPENRUM_ISSUES_MOBILE, fullPage: true });
});
