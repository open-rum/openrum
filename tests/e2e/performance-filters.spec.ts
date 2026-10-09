import { expect, test, type Page } from "@playwright/test";
import { mockOpenRUM } from "./mockOpenRUM";

async function expectCenteredScore(page: Page) {
  await expect(page.locator(".performance-score-total")).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  const alignment = await page.locator(".performance-score-dial").evaluate((svg) => {
    const number = svg.querySelector(".performance-score-total")!.getBoundingClientRect();
    const ring = svg.getBoundingClientRect();
    return {
      dx: number.x + number.width / 2 - (ring.x + (ring.width * 120) / 240),
      dy: number.y + number.height / 2 - (ring.y + (ring.height * 106) / 220),
      labelsInside: [...svg.querySelectorAll(".performance-score-label")].every((label) => {
        const bounds = label.getBoundingClientRect();
        return (
          bounds.left >= ring.left &&
          bounds.right <= ring.right &&
          bounds.top >= ring.top &&
          bounds.bottom <= ring.bottom
        );
      }),
    };
  });
  expect(Math.abs(alignment.dx)).toBeLessThan(1);
  expect(Math.abs(alignment.dy)).toBeLessThan(1);
  expect(alignment.labelsInside).toBe(true);
}

test("percentiles survive reload and route drill-down navigation", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1080 });
  await mockOpenRUM(page, { projectExists: true });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/performance?from=2026-08-28T00:00:00Z&to=2026-09-03T00:00:00Z");
  const score = page.locator(".performance-score-dial");
  await expect(score).toHaveAttribute("aria-label", "性能评分 90 / 100");
  await expectCenteredScore(page);
  await page.getByRole("combobox", { name: "统计分位数" }).click();
  await page.getByRole("option", { name: "P95", exact: true }).click();
  await expect(page.locator(".performance-metric-value").first()).toContainText("3615 ms");
  await expect(score).toHaveAttribute("aria-label", "性能评分 90 / 100");
  const chart = page.getByRole("img", { name: "Web Vitals P95 真实值趋势" });
  const box = await chart.boundingBox();
  if (!box) throw new Error("Missing LCP chart");
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2);
  await expect(page.locator(".performance-chart-tooltip")).toBeVisible();
  await page.getByRole("button", { name: "CLS 趋势", exact: true }).click();
  await expect(page.locator(".performance-combined-chart .recharts-line-curve")).toHaveCount(4);
  await expect(score).toHaveAttribute("aria-label", "性能评分 90 / 100");
  await expect(page.getByText("右轴：CLS（无单位）")).toHaveCount(0);
  await page.getByRole("combobox", { name: "统计分位数" }).click();
  await page.getByRole("option", { name: "P50", exact: true }).click();
  await expect(page.locator(".performance-metric-value").first()).toContainText("1687 ms");
  await expect(page.locator(".performance-combined-chart .recharts-line-curve")).toHaveCount(4);
  await page.getByRole("combobox", { name: "统计分位数" }).click();
  await page.getByRole("option", { name: "P95", exact: true }).click();
  await page.getByRole("button", { name: "CLS 趋势", exact: true }).click();
  await expect(page.getByRole("complementary", { name: "维度筛选侧栏" })).toHaveCount(0);
  const request = page.waitForRequest(
    (r) => r.url().includes("/performance?") && r.url().includes("route=%2Fcheckout"),
  );
  await page.getByRole("button", { name: "/checkout", exact: true }).click();
  const applied = new URL((await request).url()).searchParams;
  expect(applied.get("percentile")).toBe("p95");
  await expect(page.getByRole("heading", { name: "/checkout", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "/checkout", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "返回 Route 列表" }).click();
  expect(new URL(page.url()).searchParams.has("route")).toBe(false);
  await page.goBack();
  await expect(page.getByRole("heading", { name: "/checkout", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("mobile route drill-down has no horizontal page overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockOpenRUM(page, { projectExists: true });
  await page.goto("/performance");
  await expectCenteredScore(page);
  await expect(page.getByRole("button", { name: "筛选", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "/checkout", exact: true }).click();
  await expect(page.getByRole("heading", { name: "/checkout", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
