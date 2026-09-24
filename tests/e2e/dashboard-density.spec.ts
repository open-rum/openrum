import { expect, test } from "@playwright/test";
import { createWidget } from "../../apps/web/src/features/dashboard/model";
import { mockOpenRUM, overview, projectId } from "./mockOpenRUM";

test("all charts share a 30-point target across ranges and viewport sizes", async ({ page }) => {
  await page.setViewportSize({ width: 1939, height: 1324 });
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
  await mockOpenRUM(page, { projectExists: true });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const requests: number[] = [];
  await page.route("**/api/v1/projects/*/overview/config", (route) =>
    route.fulfill({
      json: {
        config: {
          schemaVersion: 1,
          widgets: [
            ...["bar", "line", "area"].map((view) =>
              createWidget("timeseries", {
                title: view,
                view: view as "bar" | "line" | "area",
                data: { source: "overview", metrics: ["lcp"] },
              }),
            ),
            ...(["line-right", "bar-right"] as const).map((statAppearance) =>
              createWidget("stat", {
                title: statAppearance,
                statAppearance,
                data: { source: "overview", metrics: ["lcp"] },
              }),
            ),
          ],
        },
        revision: 1,
        updatedAt: null,
      },
    }),
  );
  await page.route(/\/api\/v1\/projects\/[^/]+\/overview\?/, (route) => {
    const params = new URL(route.request().url()).searchParams;
    const maxPoints = Number(params.get("maxPoints"));
    requests.push(maxPoints);
    const result = overview();
    result.from = params.get("from")!;
    result.to = params.get("to")!;
    const from = Date.parse(result.from),
      to = Date.parse(result.to);
    const minutes = [1, 2, 5, 10, 15, 30, 60, 120, 180, 240, 360, 720, 1440, 2880].find(
      (m) => (to - from) / 60000 <= m * maxPoints,
    )!;
    result.intervalSeconds = minutes * 60;
    const step = minutes * 60000;
    const start = Math.floor(from / step) * step;
    const sample = result.series[0];
    result.series = Array.from({ length: Math.ceil((to - start) / step) }, (_, i) => ({
      ...sample,
      bucket: new Date(start + i * step).toISOString(),
    }));
    return route.fulfill({ json: result });
  });
  for (const [minutes, interval, slots] of [
    [5, 60, 5],
    [60, 120, 30],
    [360, 900, 25],
    [1440, 3600, 25],
    [10080, 21600, 29],
    [43200, 86400, 31],
  ]) {
    const to = new Date("2026-09-23T09:08:00Z");
    const from = new Date(to.getTime() - minutes * 60000);
    const before = requests.length;
    await page.goto(
      `/projects/${projectId}/overview?from=${from.toISOString()}&to=${to.toISOString()}&environment=production`,
    );
    await expect(page.locator("[data-chart-interval]")).toHaveCount(3);
    expect(requests.slice(before)).toEqual([30]);
    for (const label of await page.locator("[data-chart-interval]").all())
      await expect(label).toHaveAttribute("data-chart-interval", String(interval));
    const bar = page.locator('[data-module-title="bar"]');
    await expect(bar.locator(".recharts-bar-rectangle")).toHaveCount(slots);
    await expect(
      page.locator('[data-module-title="bar-right"] .recharts-bar-rectangle'),
    ).toHaveCount(slots);
    await expect(
      page.locator('[data-module-title="line-right"] .recharts-line-curve'),
    ).toHaveAttribute("d", /M/);
    for (const axis of await page.locator(".recharts-xAxis").all())
      expect(await axis.locator(".recharts-cartesian-axis-tick").count()).toBeLessThanOrEqual(6);
    if (minutes === 1440) await page.screenshot({ path: "/tmp/openrum-30-points-24h.png" });
  }
  const beforeDetail = requests.length;
  await page.getByRole("button", { name: "bar 操作", exact: true }).click();
  await page.getByRole("menuitem", { name: "详细", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "bar 详情", exact: true })).toBeVisible();
  expect(requests.length).toBe(beforeDetail);
  await page.keyboard.press("Escape");
  await page.emulateMedia({ colorScheme: "dark" });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('[data-module-title="bar"] [data-chart-interval]')).toHaveAttribute(
    "data-chart-interval",
    "86400",
  );
  expect(await page.locator('[data-module-title="bar"] .recharts-bar-rectangle').count()).toBe(31);
  await expect
    .poll(() =>
      page
        .locator('[data-module-title="bar"] .recharts-xAxis .recharts-cartesian-axis-tick')
        .count(),
    )
    .toBeLessThanOrEqual(3);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(requests.length).toBe(beforeDetail);
  await page.screenshot({ path: "/tmp/openrum-30-points-mobile.png" });
  expect(errors).toEqual([]);
});
