import { expect, test } from "@playwright/test";
import { mockOpenRUM, projectId as primaryProjectId } from "./mockOpenRUM";

test("the app status bar remains available outside analysis pages", async ({ page }) => {
  await mockOpenRUM(page, { projectExists: true });
  await page.goto("/projects");

  const statusBar = page.getByRole("region", { name: "应用状态栏" });
  await expect(statusBar).toBeVisible();
  await expect(statusBar.getByRole("button", { name: "切换至暗色模式" })).toBeVisible();
  await expect(page.getByRole("group", { name: "全局分析筛选" })).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(async () => {
      const [brand, bar] = await Promise.all([
        page.locator(".brand").boundingBox(),
        statusBar.boundingBox(),
      ]);
      return brand && bar ? { brand: brand.height, bar: bar.height } : null;
    })
    .toEqual({ brand: 52, bar: 52 });
});

test("time and environment stay visible and persist across analysis pages", async ({ page }) => {
  await mockOpenRUM(page, { projectExists: true });
  await page.goto(`/projects/${primaryProjectId}/analytics`);

  const statusBar = page.getByRole("region", { name: "应用状态栏" });
  const contextBar = page.getByRole("group", { name: "全局分析筛选" });
  await expect(statusBar).toBeVisible();
  await expect(statusBar).toHaveCSS("position", "sticky");
  await expect(contextBar).toBeVisible();
  await expect
    .poll(async () => {
      const [brand, bar] = await Promise.all([
        page.locator(".brand").boundingBox(),
        statusBar.boundingBox(),
      ]);
      return brand && bar ? { brand: brand.height, bar: bar.height } : null;
    })
    .toEqual({ brand: 58, bar: 58 });
  await expect(statusBar.getByRole("link")).toHaveCount(0);
  await expect(page.getByRole("tablist", { name: "分析功能" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "总览" })).toHaveAttribute("data-state", "active");
  await expect(page.getByRole("button", { name: "刷新行为分析" })).toBeVisible();

  await page.getByRole("tab", { name: "留存" }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${primaryProjectId}/analytics/retention`));
  await expect(page.getByRole("tab", { name: "留存" })).toHaveAttribute("data-state", "active");

  await page.getByRole("button", { name: /^选择时间范围/ }).click();
  await page.getByRole("button", { name: "最近 5 分钟" }).click();
  await page.getByRole("link", { name: /^切换项目，当前为/ }).hover();
  await page.getByRole("combobox", { name: "切换数据环境" }).click();
  await page.getByRole("option", { name: "全部环境" }).click();

  await expect.poll(() => new URL(page.url()).searchParams.get("environment")).toBeNull();
  await expect.poll(() => selectedDuration(page.url())).toBe(5 * 60 * 1000);

  await page.getByRole("link", { name: "错误" }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${primaryProjectId}/issues`));
  await expect(contextBar).toBeVisible();
  await expect(page.getByRole("link", { name: /环境 全部环境$/ })).toBeVisible();
  await expect.poll(() => new URL(page.url()).searchParams.get("environment")).toBeNull();
  await expect.poll(() => selectedDuration(page.url())).toBe(5 * 60 * 1000);
});

test("an absolute range is validated and stored in the shareable URL", async ({ page }) => {
  await mockOpenRUM(page, { projectExists: true });
  await page.goto(`/projects/${primaryProjectId}/performance`);

  await expect.poll(() => new URL(page.url()).searchParams.get("from")).not.toBeNull();
  const initial = new URL(page.url()).searchParams;
  const expectedFrom = new Date(initial.get("from")!);
  const expectedTo = new Date(initial.get("to")!);
  expectedFrom.setHours(10, 0, 0, 0);
  expectedTo.setHours(12, 30, 0, 0);

  await page.getByRole("button", { name: /^选择时间范围/ }).click();
  await page.getByRole("button", { name: "自定义", exact: true }).click();
  await expect(page.getByText("自定义时间范围")).toBeVisible();

  await page.getByLabel("开始时间").fill("10:00");
  await page.getByLabel("结束时间").fill("12:30");
  await page.getByRole("button", { name: "应用时间" }).click();

  await expect(page.getByText("自定义时间范围")).toBeHidden();
  await expect
    .poll(() => new URL(page.url()).searchParams.get("from"))
    .toBe(expectedFrom.toISOString());
  await expect
    .poll(() => new URL(page.url()).searchParams.get("to"))
    .toBe(expectedTo.toISOString());
});

function selectedDuration(url: string) {
  const search = new URL(url).searchParams;
  const from = new Date(search.get("from") ?? "");
  const to = new Date(search.get("to") ?? "");
  return to.getTime() - from.getTime();
}
