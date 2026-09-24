import { expect, test, type Page } from "@playwright/test";
import { createWidget, type DashboardConfig } from "../../apps/web/src/features/dashboard/model";
import { mockOpenRUM, projectId } from "./mockOpenRUM";

const metric = (count: number) => ({
  events: count,
  estimated: count,
  uniqueUsers: count,
  uniqueSessions: count,
  approximate: true,
});
const countries = ["CN", "US", "JP", "GB", "DE", "FR", "IN", "SG", "ZZ"];
const from = "2026-09-02T00:00:00.000Z",
  to = "2026-09-03T00:00:00.000Z";
async function setup(page: Page) {
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
  await mockOpenRUM(page, { projectExists: true });
  let config: DashboardConfig = {
    schemaVersion: 1,
    widgets: [
      createWidget("breakdown", { view: "donut" }),
      createWidget("breakdown", {
        title: "浏览器分布",
        view: "donut",
        data: { source: "events", dimension: "browser", metrics: ["estimated"] },
      }),
    ],
  };
  let writes = 0,
    queries = 0,
    empty = false;
  await page.route("**/api/v1/projects/*/overview/config", async (route) => {
    if (route.request().method() === "PUT") {
      config = route.request().postDataJSON().config;
      writes++;
    }
    await route.fulfill({ json: { config, revision: writes + 1, updatedAt: to } });
  });
  await page.route(/\/api\/v1\/projects\/[^/]+\/analytics\/events\?/, (route) => {
    queries++;
    const dimension = new URL(route.request().url()).searchParams.get("dimension");
    const names = dimension === "country" ? countries : ["Chrome", "Safari", "Firefox"];
    return route.fulfill({
      json: {
        from,
        to,
        dimension,
        interval: "15 MINUTE",
        totals: metric(9999),
        trend: [],
        catalog: [],
        properties: [],
        measurements: [],
        sampleCount: 9999,
        rowLimit: 100,
        freshness: { latestReceivedAt: to, ageSeconds: 0, stale: false },
        breakdown: empty
          ? []
          : names.map((value, index) => ({ value, metric: metric((10 - index) * 100) })),
      },
    });
  });
  await page.goto(`/projects/${projectId}/overview?from=${from}&to=${to}`);
  await expect(page.locator("[data-donut-distribution]")).toHaveCount(2);
  return {
    config: () => config,
    writes: () => writes,
    queries: () => queries,
    empty: () => {
      empty = true;
    },
  };
}

test("donut/list layout, keyboard highlighting, details, themes and mobile", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1550, height: 1000 });
  const state = await setup(page);
  const card = page.locator('[data-module-title="国家分布"]');
  const list = card.getByRole("table", { name: "国家分布 分布列表" });
  await expect(list.getByRole("row")).toHaveCount(7);
  await expect(list).toContainText("其他（4 项）");
  await expect(card.locator(".dashboard-donut-center")).toContainText("5400");
  await expect(card.locator(".recharts-pie-sector")).toHaveCount(6);
  const ringBounds = await card.locator(".dashboard-donut-visual").boundingBox();
  const listBounds = await list.boundingBox();
  expect(listBounds!.x).toBeGreaterThan(ringBounds!.x + ringBounds!.width);
  const china = list.getByRole("row").filter({ hasText: "中国 (CN)" });
  await china.focus();
  await expect(card.locator(".dashboard-donut-center")).toContainText("18.5%");
  await expect(china).toHaveAttribute("data-highlighted", "true");
  await page.getByRole("heading", { level: 1 }).click();
  await page.screenshot({ path: "/tmp/openrum-donut-light.png" });
  await page.getByRole("button", { name: "切换至暗色模式", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  // The theme attribute changes before table row color transitions finish.
  await expect(list.getByRole("cell").first()).toHaveCSS("color", "oklch(0.922 0 0)");
  await page.screenshot({ path: "/tmp/openrum-donut-dark.png" });
  const before = state.queries();
  await card.getByRole("button", { name: "国家分布 操作", exact: true }).click();
  await page.getByRole("menuitem", { name: "详细", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "国家分布 详情", exact: true });
  await dialog.getByRole("tab", { name: "数据表", exact: true }).click();
  await expect(dialog.getByRole("table", { name: "国家分布 数据表" }).getByRole("row")).toHaveCount(
    10,
  );
  await expect(dialog.getByRole("table", { name: "国家分布 数据表" })).toContainText(
    "未知国家 (ZZ)",
  );
  expect(state.queries()).toBe(before);
  expect(state.writes()).toBe(0);
  await dialog.getByRole("button", { name: "关闭详情" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(async () => (await list.boundingBox())!.y)
    .toBeGreaterThan((await card.locator(".dashboard-donut-visual").boundingBox())!.y);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "/tmp/openrum-donut-mobile.png" });
  expect(errors).toEqual([]);
});

test("presets can be added, saved and restored; existing breakdowns switch views", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1550, height: 1000 });
  const state = await setup(page);
  await page.getByRole("button", { name: "编辑概览", exact: true }).click();
  await page.getByRole("button", { name: "添加模块", exact: true }).click();
  const library = page.getByRole("dialog", { name: "模块库", exact: true });
  await expect(library).toHaveCSS("width", "1040px");
  for (const label of ["国家", "设备", "浏览器", "来源"]) {
    await expect(
      page.getByRole("button", { name: `添加${label}圆环分布`, exact: true }),
    ).toBeVisible();
  }
  await page.getByRole("button", { name: "添加设备圆环分布", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "添加模块", exact: true });
  await expect(editor).toHaveCSS("width", "1040px");
  await page.screenshot({ path: "/tmp/openrum-module-editor-wide.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(editor).toHaveCSS("width", "390px");
  expect(await editor.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await expect(editor.getByRole("button", { name: "添加到概览", exact: true })).toBeInViewport();
  await page.screenshot({ path: "/tmp/openrum-module-editor-mobile.png" });
  await page.setViewportSize({ width: 1550, height: 1000 });
  await expect(editor.getByRole("radio", { name: "圆环 + 列表", exact: true })).toHaveAttribute(
    "data-state",
    "on",
  );
  await expect(editor.locator("[data-donut-distribution]")).toBeVisible();
  await editor.getByRole("button", { name: "添加到概览", exact: true }).click();
  await page.getByRole("button", { name: "保存概览", exact: true }).click();
  await expect(page.getByRole("button", { name: "编辑概览", exact: true })).toBeVisible();
  expect(state.config().widgets.at(-1)?.view).toBe("donut");
  expect(state.writes()).toBe(1);
  await page.reload();
  const card = page.locator('[data-module-title="设备分布"]');
  await expect(card.locator("[data-donut-distribution]")).toBeVisible();
  await card.getByRole("button", { name: "设备分布 操作", exact: true }).click();
  await page.getByRole("menuitem", { name: "配置模块", exact: true }).click();
  const configure = page.getByRole("dialog", { name: "配置模块", exact: true });
  await expect(configure).toHaveCSS("width", "1040px");
  await configure.getByRole("radio", { name: "Bar", exact: true }).click();
  await configure.getByRole("button", { name: "应用修改", exact: true }).click();
  await expect(card.locator("[data-donut-distribution]")).toHaveCount(0);
  await page.getByRole("button", { name: "保存概览", exact: true }).click();
  await expect(page.getByRole("button", { name: "编辑概览", exact: true })).toBeVisible();
  state.empty();
  await page.reload();
  await expect(page.locator(".recharts-pie-sector")).toHaveCount(0);
  await expect(page.getByText("当前范围暂无数据", { exact: true })).toHaveCount(3);
});
