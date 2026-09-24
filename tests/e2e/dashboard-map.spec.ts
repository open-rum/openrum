import { expect, test, type Page } from "@playwright/test";
import { createWidget, type DashboardConfig } from "../../apps/web/src/features/dashboard/model";
import type { BehaviorAnalyticsResponse } from "../../apps/web/src/lib/api/analytics";
import { mockOpenRUM, projectId } from "./mockOpenRUM";

const metric = (events: number) => ({
  events,
  estimated: events,
  uniqueUsers: Math.round(events / 2),
  uniqueSessions: events,
  approximate: true,
});
const countries = ["CN", "US", "GB", "DE", "FR", "JP", "IN", "BR", "CA", "SG", "AU", "NZ", "ZZ"];
const analytics: BehaviorAnalyticsResponse = {
  from: "2026-09-02T00:00:00.000Z",
  to: "2026-09-03T00:00:00.000Z",
  dimension: "country",
  interval: "15 MINUTE",
  totals: metric(45000),
  trend: [],
  catalog: [],
  properties: [],
  measurements: [],
  breakdown: countries.map((value, i) => ({
    value,
    metric: metric(i === 0 ? 12400 : (countries.length - i) * 120),
  })),
  freshness: { latestReceivedAt: "2026-09-03T00:00:00.000Z", ageSeconds: 0, stale: false },
  sampleCount: 45000,
  rowLimit: 250,
};

async function setup(page: Page, map = false) {
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
  await mockOpenRUM(page, { projectExists: true });
  let config: DashboardConfig = {
    schemaVersion: 1,
    widgets: [
      { ...createWidget("breakdown", { view: map ? "map" : "bar" }), id: "countries" },
      {
        ...createWidget("breakdown", {
          title: "设备分布",
          data: { source: "events", dimension: "device", metrics: ["estimated"] },
        }),
        id: "devices",
      },
    ],
  };
  let revision = 1;
  let writes = 0;
  let dataQueries = 0;
  await page.route("**/api/v1/projects/*/overview/config", async (route) => {
    if (route.request().method() === "PUT") {
      config = route.request().postDataJSON().config;
      revision++;
      writes++;
    }
    await route.fulfill({ json: { config, revision, updatedAt: analytics.to } });
  });
  await page.route(/\/api\/v1\/projects\/[^/]+\/analytics\/events\?/, (route) => {
    dataQueries++;
    const dimension = new URL(route.request().url()).searchParams.get("dimension");
    return route.fulfill({
      json:
        dimension === "country"
          ? analytics
          : {
              ...analytics,
              dimension,
              breakdown: [
                { value: "mobile", metric: metric(9500) },
                { value: "desktop", metric: metric(3300) },
              ],
            },
    });
  });
  await page.goto(`/projects/${projectId}/overview?from=${analytics.from}&to=${analytics.to}`);
  await expect(page.locator('[data-module-title="国家分布"]')).toBeVisible();
  return { writes: () => writes, queries: () => dataQueries, config: () => config };
}

async function configure(page: Page, title = "国家分布") {
  await page.getByRole("button", { name: `${title} 操作`, exact: true }).click();
  await page.getByRole("menuitem", { name: "配置模块", exact: true }).click();
  return page.getByRole("dialog", { name: "配置模块", exact: true });
}

test("country map can be previewed, saved and reloaded; details keep all countries without extra queries", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1350, height: 964 });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  const state = await setup(page);
  expect(state.writes()).toBe(0);
  const editor = await configure(page);
  await editor.getByRole("radio", { name: "世界地图", exact: true }).click();
  await expect(editor.getByRole("group", { name: "国家分布 世界地图", exact: true })).toBeVisible();
  expect(state.writes()).toBe(0);
  await editor.getByRole("button", { name: "应用修改", exact: true }).click();
  await page.getByRole("button", { name: "保存概览", exact: true }).click();
  await expect(page.getByRole("button", { name: "编辑概览", exact: true })).toBeVisible();
  expect(state.config().widgets[0].view).toBe("map");
  expect(state.writes()).toBe(1);
  await page.reload();
  const card = page.locator('[data-module-title="国家分布"]');
  const map = card.getByRole("group", { name: "国家分布 世界地图", exact: true });
  await expect(map).toBeVisible();
  await expect(map.getByRole("button", { name: /新西兰 \(NZ\)/ })).toBeVisible();
  await expect(card.getByRole("status")).toContainText("1 个分组未定位");
  await expect(card.getByRole("table")).toHaveCount(0);
  const china = map.getByRole("button", {
    name: "中国 (CN) · 事件次数（估算） 12,400",
    exact: true,
  });
  await china.hover();
  await expect(page.getByRole("tooltip")).toBeVisible();
  await expect(page.getByRole("tooltip")).toContainText("12,400");
  await page.getByRole("heading", { level: 1 }).hover();
  await china.focus();
  await expect(page.getByRole("tooltip")).toContainText("12,400");
  await page.keyboard.press("Escape");
  await page.getByRole("heading", { level: 1 }).click();
  await page.screenshot({ path: "/tmp/openrum-dashboard-world-map-light.png" });
  await page.getByRole("button", { name: "切换至暗色模式", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("heading", { level: 1 }).click();
  await page.waitForFunction(() =>
    document.getAnimations().every((animation) => animation.playState !== "running"),
  );
  await page.screenshot({ path: "/tmp/openrum-dashboard-world-map-dark.png" });
  const queries = state.queries();
  await card.hover();
  await card.getByRole("button", { name: "国家分布 操作", exact: true }).click();
  await page.getByRole("menuitem", { name: "详细", exact: true }).click();
  const details = page.getByRole("dialog", { name: "国家分布 详情", exact: true });
  await details.getByRole("tab", { name: "数据表", exact: true }).click();
  await expect(details.getByRole("table").getByRole("row")).toHaveCount(countries.length + 1);
  await expect(details.getByRole("table")).toContainText("未知国家 (ZZ)");
  await expect(details.getByRole("table")).toContainText("12,400");
  expect(state.queries()).toBe(queries);
  expect(state.writes()).toBe(1);
  await details.getByRole("button", { name: "关闭详情" }).click();
  expect(errors).toEqual([]);
});

test("changing away from country removes map and falls back to a valid bar configuration", async ({
  page,
}) => {
  await setup(page, true);
  const editor = await configure(page);
  await editor.getByRole("combobox", { name: "分组维度", exact: true }).click();
  await page.getByRole("option", { name: "设备", exact: true }).click();
  await expect(editor.getByRole("radio", { name: "世界地图", exact: true })).toHaveCount(0);
  await expect(editor.getByRole("radio", { name: "Bar", exact: true })).toHaveAttribute(
    "data-state",
    "on",
  );
  await expect(editor.getByRole("button", { name: "应用修改", exact: true })).toBeEnabled();
});

test("mobile map supports tapping small countries and a bounded details dialog", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  await setup(page, true);
  const card = page.locator('[data-module-title="国家分布"]');
  const singapore = card.locator('[data-country-id="702"] circle');
  await expect(singapore).toBeVisible();
  await singapore.tap();
  await expect(page.getByRole("tooltip")).toBeVisible();
  await expect(page.getByRole("tooltip")).toContainText("新加坡 (SG)");
  await expect(page.locator('[data-slot="tooltip-content"]').first()).toHaveCSS("opacity", "1");
  await page.screenshot({ path: "/tmp/openrum-dashboard-world-map-mobile.png" });
  await card.getByRole("button", { name: "国家分布 操作", exact: true }).click();
  await page.getByRole("menuitem", { name: "详细", exact: true }).click();
  const details = page.getByRole("dialog", { name: "国家分布 详情", exact: true });
  await details.getByRole("tab", { name: "数据表", exact: true }).click();
  await expect(details.getByRole("table").getByRole("row")).toHaveCount(14);
  const bounds = await details.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(844);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await context.close();
});
