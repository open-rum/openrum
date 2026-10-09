import { expect, test } from "@playwright/test";
import { mockOpenRUM, projectId } from "./mockOpenRUM";

test("a recent six-hour window keeps rolling and stays selected across navigation", async ({
  page,
}) => {
  await page.clock.install({ time: new Date("2026-09-30T10:00:10.000Z") });
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await mockOpenRUM(page, { projectExists: true });
  await page.route(`**/api/v1/projects/${projectId}/logs?*`, (route) =>
    route.fulfill({
      json: { items: [], trend: [], total: 0, nextCursor: "", intervalSeconds: 900 },
    }),
  );
  await page.goto(`/projects/${projectId}/overview`);

  const trigger = page.getByRole("button", { name: /选择时间范围，当前为/ });
  await expect(trigger).toBeVisible();
  await trigger.click();
  await page.getByRole("button", { name: "最近 6 小时" }).click();
  await expect(trigger).toContainText("最近 6 小时");

  const selectedURL = new URL(page.url());
  const selectedFrom = Date.parse(selectedURL.searchParams.get("from") ?? "");
  const selectedTo = Date.parse(selectedURL.searchParams.get("to") ?? "");
  expect(selectedURL.searchParams.get("timePreset")).toBe("6h");
  expect(selectedTo - selectedFrom).toBe(6 * 60 * 60 * 1000);

  await page.clock.fastForward("03:00");
  await expect
    .poll(() => Date.parse(new URL(page.url()).searchParams.get("to") ?? ""))
    .toBe(selectedTo + 3 * 60_000);
  await expect(trigger).toContainText("最近 6 小时");

  await page.reload();
  await expect(trigger).toContainText("最近 6 小时");
  await page
    .getByRole("navigation", { name: "主导航" })
    .getByRole("link", { name: "日志" })
    .click();
  await expect(page).toHaveURL(/\/logs\?/);
  await expect(page).toHaveTitle(/OpenRUM/);
  await expect(page.getByRole("heading", { name: "日志", exact: true })).toBeVisible();
  await expect(page.getByText("当前范围没有日志")).toBeVisible();
  await expect(trigger).toContainText("最近 6 小时");
  expect(new URL(page.url()).searchParams.get("timePreset")).toBe("6h");
  await expect(page.locator("vite-error-overlay")).toHaveCount(0);
  expect(pageErrors).toEqual([]);
  await page.screenshot({ path: "/tmp/openrum-six-hour-range.png" });
});
