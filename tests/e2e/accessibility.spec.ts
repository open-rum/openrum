import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { mockOpenRUM } from "./mockOpenRUM";

const corePages = ["/", "/issues", "/performance", "/apis", "/usage", "/alerts", "/settings"];

for (const path of corePages) {
  test(`core page ${path} has no critical WCAG findings`, async ({ page }) => {
    await mockOpenRUM(page, { projectExists: true });
    await page.goto(path);
    await expect(page.locator("main")).toBeVisible();
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    const critical = results.violations.filter((violation) => violation.impact === "critical");
    expect(critical, JSON.stringify(critical, null, 2)).toEqual([]);
  });
}

test("keyboard user can skip navigation and activate a primary route", async ({ page }) => {
  await mockOpenRUM(page, { projectExists: true });
  await page.goto("/");
  await expect(page).toHaveURL(/\/projects\/[^/]+\/analytics(?:\?.*)?$/);
  await expect(page.getByRole("heading", { name: "用户行为分析" })).toBeVisible();
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "跳到主要内容" });
  await expect(skip).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main-content")).toBeFocused();

  await page.getByRole("link", { name: "错误" }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/projects\/[^/]+\/issues(?:\?.*)?$/);
  await expect(page.getByRole("heading", { name: "错误问题" })).toBeVisible();
});
