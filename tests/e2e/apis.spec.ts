import { expect, test } from "@playwright/test";
import { mockOpenRUM } from "./mockOpenRUM";

test("API list groups dynamic routes, server sorts and opens a safe detail drawer", async ({
  page,
}) => {
  await mockOpenRUM(page, { projectExists: true });
  await page.goto("/apis");
  await expect(page.getByRole("heading", { name: "API 监控" })).toBeVisible();
  // The endpoint name also appears in the overview charts, so assertions about
  // the list stay scoped to the list.
  const list = page.getByRole("region", { name: "API endpoint 列表" });
  await expect(list.getByText("https://api.example/products/:id")).toBeVisible();
  await expect(page.locator("body")).not.toContainText("/ingest/v1/envelope");

  await page.getByLabel("API 排序").click();
  await page.getByRole("option", { name: "P95 延迟" }).click();
  await expect(page).toHaveURL(/sort=p95/);
  await list.getByText("https://api.example/products/:id").click();
  const drawer = page.getByRole("dialog", { name: "https://api.example/products/:id" });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText("1830 ms")).toBeVisible();
  await expect(drawer).not.toContainText("token=");
  if (process.env.OPENRUM_APIS_SCREENSHOT)
    await page.screenshot({ path: process.env.OPENRUM_APIS_SCREENSHOT, fullPage: true });
  await page.getByRole("button", { name: "关闭详情" }).click();
  await expect(drawer).not.toBeVisible();
});

test("API workspace leads with compared health and marks low-sample quantiles", async ({
  page,
}) => {
  await mockOpenRUM(page, { projectExists: true });
  await page.goto("/apis");

  const overview = page.getByRole("region", { name: "API 健康概览" });
  await expect(overview.getByText("失败率", { exact: true })).toBeVisible();
  await expect(overview.getByTitle("对比上一个等长周期").first()).toBeVisible();
  await expect(
    overview.getByRole("img", { name: "全部 endpoint 请求量与失败构成趋势" }),
  ).toBeVisible();

  await expect(
    page.getByRole("region", { name: "API endpoint 列表" }).getByText("样本不足"),
  ).toBeVisible();
});

test("API workspace separates the slowest endpoint from the one that carries the time", async ({
  page,
}) => {
  await mockOpenRUM(page, { projectExists: true });
  await page.goto("/apis");

  const overview = page.getByRole("region", { name: "API 健康概览" });
  await expect(overview.getByRole("img", { name: "endpoint 请求量与 P95 延迟分布" })).toBeVisible();
  await expect(overview.getByRole("img", { name: "endpoint 耗时权重排行" })).toBeVisible();

  // DELETE /carts/:id/items/:id has the worst P95 in the fixture at 4200 ms, yet
  // /products/:id carries the time because it is called far more often.
  await expect(overview.getByText(/占当前范围总耗时的 71\.4%/)).toBeVisible();
  await expect(overview.locator(".api-time-spent-note code")).toHaveText(
    "GET https://api.example/products/:id",
  );
});

test("API filters narrow the list by method and endpoint search", async ({ page }) => {
  await mockOpenRUM(page, { projectExists: true });
  await page.goto("/apis");

  await page.getByRole("button", { name: "POST", exact: true }).click();
  await expect(page).toHaveURL(/methods=POST/);

  await page.getByLabel("搜索 endpoint").fill("orders");
  await page.getByRole("button", { name: "查询" }).click();
  await expect(page).toHaveURL(/search=orders/);

  await page.getByRole("button", { name: "清除筛选" }).click();
  await expect(page).not.toHaveURL(/search=orders/);
});

test("API detail explains status codes, latency shape and links to the session", async ({
  page,
}) => {
  await mockOpenRUM(page, { projectExists: true });
  await page.goto("/apis");
  await page
    .getByRole("region", { name: "API endpoint 列表" })
    .getByText("https://api.example/products/:id")
    .click();

  const drawer = page.getByRole("dialog", { name: "https://api.example/products/:id" });
  await expect(drawer.getByRole("list", { name: "响应状态码分布" }).getByText("404")).toBeVisible();
  await expect(drawer.getByRole("list", { name: "延迟分布" }).getByText("≥ 3s")).toBeVisible();
  await expect(drawer.getByText("4.7 KB")).toBeVisible();

  await drawer.getByRole("button", { name: "操作系统" }).click();
  await expect(drawer.getByRole("cell", { name: "macOS" })).toBeVisible();

  await drawer.getByRole("link", { name: "查看会话" }).click();
  await expect(page).toHaveURL(/\/sessions\?.*search=018f4d9c-83a1-76c9-81c2-3020ab667099/);
});

test("opening a detail drawer holds the page still, while changing route returns to the top", async ({
  page,
}) => {
  await mockOpenRUM(page, { projectExists: true });
  await page.setViewportSize({ width: 1500, height: 900 });
  await page.goto("/apis");

  const list = page.getByRole("region", { name: "API endpoint 列表" });
  await expect(list).toBeVisible();
  await list.scrollIntoViewIfNeeded();
  const offset = await page.evaluate(() => Math.round(window.scrollY));
  expect(offset).toBeGreaterThan(100);

  // Filters live in the query string and are committed with pushState, which
  // the router would otherwise answer by scrolling to the top.
  await list.getByText("https://api.example/products/:id").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBe(offset);

  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBe(offset);

  await page.getByRole("link", { name: "性能" }).click();
  await expect(page).toHaveURL(/performance/);
  await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBe(0);
});
