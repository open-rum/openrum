import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const keyPages = ["/", "/product", "/self-host", "/docs/getting-started/quickstart/"];

for (const path of keyPages) {
  test(`${path} has metadata, one main heading and no critical accessibility findings`, async ({
    page,
  }) => {
    await page.goto(path);
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page).toHaveTitle(/OpenRUM|Quickstart/);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /.+/);
    await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /.+/);
    await expect(page.locator("[data-openrum-build]")).toContainText(/Release .+ · commit .+/);
    const result = await new AxeBuilder({ page }).analyze();
    expect(result.violations.filter((violation) => violation.impact === "critical")).toEqual([]);
  });
}

test("theme and equivalent language navigation work without a network tracker", async ({
  page,
}) => {
  const foreignRequests = [];
  page.on("request", (request) => {
    if (new URL(request.url()).origin !== "http://127.0.0.1:4322")
      foreignRequests.push(request.url());
  });
  await page.goto("/product");
  await page.getByRole("button", { name: "Toggle color theme" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.getByRole("link", { name: "切换到简体中文" }).click();
  await expect(page).toHaveURL(/\/zh\/product\/?$/);
  expect(foreignRequests).toEqual([]);
});

test("docs language switch is site-wide and does not mix sidebar locales", async ({ page }) => {
  await page.goto("/docs/getting-started/quickstart/");
  const sidebar = page.locator("#starlight__sidebar");
  await expect(sidebar.getByText("Start Here", { exact: true }).first()).toBeVisible();
  await expect(sidebar.locator(".group-label", { hasText: "简体中文" })).toHaveCount(0);
  await page.locator("starlight-lang-select select").first().selectOption({ label: "简体中文" });
  await expect(page).toHaveURL(/\/zh\/docs\/getting-started\/quickstart\/?$/);
  await expect(page.locator("h1")).toContainText("五分钟快速开始");
  const zhSidebar = page.locator("#starlight__sidebar");
  await expect(zhSidebar.getByText("从这里开始", { exact: true }).first()).toBeVisible();
  await expect(zhSidebar.locator(".group-label", { hasText: "Start Here" })).toHaveCount(0);
});

test("documentation search is local", async ({ page }) => {
  const foreignRequests = [];
  page.on("request", (request) => {
    if (new URL(request.url()).origin !== "http://127.0.0.1:4322")
      foreignRequests.push(request.url());
  });
  await page.goto("/docs/getting-started/quickstart/");
  const search = page.getByRole("button", { name: /search/i }).first();
  await search.click();
  await page.getByRole("textbox").fill("Source Map");
  expect(foreignRequests).toEqual([]);
});
