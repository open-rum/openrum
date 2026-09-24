import { expect, test, type Page } from "@playwright/test";
import {
  createWidget,
  statAppearanceLabels,
  type DashboardConfig,
  type StatAppearance,
} from "../../apps/web/src/features/dashboard/model";
import { mockOpenRUM, overview, projectId } from "./mockOpenRUM";

async function setup(page: Page, gallery = false) {
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
  await mockOpenRUM(page, { projectExists: true });
  const result = overview();
  result.comparison.changes.pageViewsPercent = 12;
  let config: DashboardConfig = {
    schemaVersion: 1,
    widgets: gallery
      ? Object.entries(statAppearanceLabels).map(([appearance, title]) =>
          createWidget("stat", { title, statAppearance: appearance as StatAppearance }),
        )
      : [createWidget("stat")],
  };
  let revision = 1;
  let writes = 0;
  let queries = 0;
  await page.route("**/api/v1/projects/*/overview/config", async (route) => {
    if (route.request().method() === "PUT") {
      config = route.request().postDataJSON().config;
      writes++;
      revision++;
    }
    await route.fulfill({ json: { config, revision, updatedAt: result.to } });
  });
  await page.route(/\/api\/v1\/projects\/[^/]+\/overview\?/, (route) => {
    queries++;
    return route.fulfill({ json: result });
  });
  await page.goto(`/projects/${projectId}/overview?from=${result.from}&to=${result.to}`);
  await expect(page.locator("[data-module-title] strong").first()).toHaveText("9900");
  return { writes: () => writes, queries: () => queries, config: () => config, result };
}

async function configure(page: Page, title = "PV") {
  await page.getByRole("button", { name: `${title} 操作`, exact: true }).click();
  await page.getByRole("menuitem", { name: "配置模块", exact: true }).click();
  return page.getByRole("dialog", { name: "配置模块", exact: true });
}

test("Stat appearances apply, save and reload without changing query or aggregate semantics", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const state = await setup(page);
  for (const appearance of ["line-right", "bar-right", "plain"] as const) {
    const label = statAppearanceLabels[appearance];
    const before = state.queries();
    const editor = await configure(page);
    await expect(
      editor.getByRole("radiogroup", { name: "卡片外观" }).getByRole("radio"),
    ).toHaveCount(3);
    await expect(editor.getByRole("radio", { name: /底部/ })).toHaveCount(0);
    await editor.getByRole("radio", { name: label, exact: true }).click();
    if (appearance === "bar-right")
      await expect(editor.locator(".recharts-bar-rectangle path").first()).toHaveAttribute(
        "d",
        /M/,
      );
    await editor.getByRole("button", { name: "应用修改", exact: true }).click();
    const card = page.locator('[data-module-title="PV"]');
    await expect(card.locator("strong")).toHaveText("9900");
    if (appearance !== "plain") {
      await expect(card.locator(`[data-stat-appearance="${appearance}"]`)).toBeVisible();
      await expect(
        card
          .locator(
            appearance === "bar-right" ? ".recharts-bar-rectangle path" : ".recharts-line-curve",
          )
          .first(),
      ).toHaveAttribute("d", /M/);
    } else {
      await expect(card.locator('[data-slot="chart"]')).toHaveCount(0);
    }
    expect(state.queries()).toBe(before);
    await page.getByRole("button", { name: "保存概览", exact: true }).click();
    await expect(page.getByRole("button", { name: "保存概览", exact: true })).toHaveCount(0);
    expect(state.config().widgets[0].statAppearance).toBe(appearance);
    await page.reload();
    await expect(page.locator('[data-module-title="PV"] strong')).toHaveText("9900");
    if (appearance !== "plain")
      await expect(page.locator(`[data-stat-appearance="${appearance}"]`)).toBeVisible();
  }
  expect(state.writes()).toBe(3);
  const editor = await configure(page);
  await editor.getByRole("radio", { name: "右侧折线", exact: true }).click();
  await editor.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("button", { name: "放弃修改", exact: true }).click();
  await expect(page.locator('[data-module-title="PV"] [data-stat-appearance]')).toHaveCount(0);
  expect(state.writes()).toBe(3);
  expect(errors).toEqual([]);
});

test("mini line and bar charts stay right of values and display-only in both themes", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1350, height: 900 });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await setup(page, true);
  await expect(page).toHaveURL(/\/overview\?/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator("vite-error-overlay")).toHaveCount(0);
  const right = page.locator('[data-module-title="右侧折线"]');
  const value = await right.locator("strong").boundingBox();
  const chart = right.locator('[data-slot="chart"]');
  const bounds = await chart.boundingBox();
  expect(bounds!.x).toBeGreaterThan(value!.x + value!.width);
  const bars = page.locator('[data-module-title="右侧柱状图"]');
  const barValue = await bars.locator("strong").boundingBox();
  const barChart = await bars.locator('[data-slot="chart"]').boundingBox();
  expect(barChart!.x).toBeGreaterThan(barValue!.x + barValue!.width);
  await expect(bars.locator(".recharts-bar-rectangle path").first()).toHaveAttribute("d", /M/);
  await expect(bars.getByText("页面浏览次数", { exact: true })).toHaveCount(0);
  // Decorative charts cannot intercept hover, clicks or keyboard focus.
  for (const mini of await page.locator('[data-module-title] [data-slot="chart"]').all()) {
    await expect(mini).toHaveCSS("pointer-events", "none");
    await expect(mini).toHaveAttribute("inert", "");
    await expect(mini).toHaveAttribute("aria-hidden", "true");
    await expect(mini.locator('[tabindex="0"]')).toHaveCount(0);
  }
  await page.mouse.move(bounds!.x + 20, bounds!.y + 30);
  await expect(page.locator(".recharts-tooltip-wrapper, .recharts-active-dot")).toHaveCount(0);
  await page.screenshot({ path: "/tmp/openrum-stat-right-light.png" });
  await page.getByRole("button", { name: "切换至暗色模式", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.screenshot({ path: "/tmp/openrum-stat-right-dark.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(right.locator(".recharts-line-curve")).toHaveAttribute("d", /M/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await bars.scrollIntoViewIfNeeded();
  await expect(bars.locator(".recharts-bar-rectangle path").first()).toHaveAttribute("d", /M/);
  await page.screenshot({ path: "/tmp/openrum-stat-right-mobile.png" });
  await right.getByRole("button", { name: "右侧折线 操作", exact: true }).click();
  await page.getByRole("menuitem", { name: "详细", exact: true }).click();
  await page.getByRole("dialog").getByRole("tab", { name: "数据表", exact: true }).click();
  await expect(page.getByRole("table", { name: "右侧折线 数据表" }).getByRole("row")).toHaveCount(
    289,
  );
  await page.getByRole("dialog").getByRole("tab", { name: "趋势", exact: true }).click();
  const detailChart = page.getByRole("dialog").locator('[data-slot="chart"]');
  await detailChart.scrollIntoViewIfNeeded();
  // Hover a real sample, not an empty interval between sparse fixture points.
  await detailChart.locator(".dashboard-isolated-dot").first().hover();
  await expect(page.getByRole("dialog").locator(".recharts-tooltip-wrapper")).toBeVisible();
  expect(errors).toEqual([]);
});

test("empty Stat series shows no synthetic line", async ({ page }) => {
  const state = await setup(page, true);
  state.result.kpis.pageViews.samples = 0;
  state.result.kpis.pageViews.value = 0;
  state.result.series = [];
  await page.reload();
  await expect(page.getByText("暂无趋势数据", { exact: true })).toHaveCount(2);
  await expect(page.locator(".recharts-line-curve, .recharts-bar-rectangle")).toHaveCount(0);
});

test("retired bottom appearances open as right-side lines without automatic saves", async ({
  page,
}) => {
  const state = await setup(page);
  state.config().widgets = ["line-bottom", "area-bottom"].map((statAppearance) => ({
    ...createWidget("stat", { title: statAppearance }),
    statAppearance,
  }));
  await page.reload();
  await expect(page.locator('[data-stat-appearance="line-right"]')).toHaveCount(2);
  await expect(page.locator('[data-stat-appearance$="bottom"]')).toHaveCount(0);
  const editor = await configure(page, "area-bottom");
  await expect(editor.getByRole("radio", { name: "右侧折线", exact: true })).toHaveAttribute(
    "data-state",
    "on",
  );
  await expect(editor.getByRole("radio", { name: /底部/ })).toHaveCount(0);
  expect(state.writes()).toBe(0);
});

test("smooth curves are consistent in mini, page and enlarged charts without bridging gaps", async ({
  page,
}) => {
  const state = await setup(page, true);
  const sample = state.result.series[0];
  const start = Date.parse(state.result.from);
  state.result.series = [30, 80, 40, null, 70, null, 20, 60, 40].flatMap((value, index) =>
    value === null
      ? []
      : [
          {
            ...sample,
            bucket: new Date(start + index * 300000).toISOString(),
            pageViews: { value, samples: value },
          },
        ],
  );
  state.config().widgets.push(
    ...(["line", "area"] as const).map((view) =>
      createWidget("timeseries", {
        title: `smooth-${view}`,
        view,
        data: { source: "overview", metrics: ["pageViews"] },
      }),
    ),
  );
  await page.reload();
  const cards = page.locator("[data-module-title]").filter({
    has: page.locator(".recharts-line-curve, .recharts-area-curve"),
  });
  await expect(cards).toHaveCount(3);
  for (const card of await cards.all()) {
    const curve = card.locator(".recharts-line-curve, .recharts-area-curve");
    await expect(curve).toHaveAttribute("d", /C/);
    await expect(curve).toHaveAttribute("stroke-linecap", "round");
    await expect(curve).toHaveAttribute("stroke-linejoin", "round");
    // Two connected runs and one isolated sample, with a gap on either side.
    expect((await curve.getAttribute("d"))!.match(/M/g)).toHaveLength(3);
    await expect(card.locator(".dashboard-isolated-dot")).toHaveCount(1);
  }
  const before = state.queries();
  await page.getByRole("button", { name: "smooth-line 操作", exact: true }).click();
  await page.getByRole("menuitem", { name: "详细", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "smooth-line 详情", exact: true });
  const curve = dialog.locator(".recharts-line-curve");
  await expect(curve).toHaveAttribute("d", /C/);
  expect((await curve.getAttribute("d"))!.match(/M/g)).toHaveLength(3);
  await expect(dialog.locator(".dashboard-isolated-dot")).toHaveCount(1);
  await dialog.getByRole("tab", { name: "数据表", exact: true }).click();
  await expect(dialog.getByRole("cell", { name: "80", exact: true })).toHaveCount(1);
  expect(state.queries()).toBe(before);
  expect(state.writes()).toBe(0);
});
