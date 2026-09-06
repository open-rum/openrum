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
  await expect(
    page.locator(".behavior-header").getByRole("button", { name: "刷新行为分析" }),
  ).toBeVisible();

  await page.getByRole("tab", { name: "留存" }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${primaryProjectId}/analytics/retention`));
  await expect(page.getByRole("tab", { name: "留存" })).toHaveAttribute("data-state", "active");

  await page.getByRole("combobox", { name: "全局时间范围" }).click();
  await page.getByRole("option", { name: "最近 5 分钟" }).click();
  await page.getByRole("combobox", { name: "全局环境" }).click();
  await page.getByRole("option", { name: "Test" }).click();

  await expect.poll(() => new URL(page.url()).searchParams.get("environment")).toBe("test");
  await expect.poll(() => selectedDuration(page.url())).toBe(5 * 60 * 1000);

  await page.getByRole("link", { name: "错误" }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${primaryProjectId}/issues`));
  await expect(contextBar).toBeVisible();
  await expect(page.getByRole("combobox", { name: "全局环境" })).toContainText("Test");
  await expect.poll(() => new URL(page.url()).searchParams.get("environment")).toBe("test");
  await expect.poll(() => selectedDuration(page.url())).toBe(5 * 60 * 1000);
});

test("an absolute range is validated and stored in the shareable URL", async ({ page }) => {
  await mockOpenRUM(page, { projectExists: true });
  await page.goto(`/projects/${primaryProjectId}/performance`);

  await page.getByRole("combobox", { name: "全局时间范围" }).click();
  await page.getByRole("option", { name: "自定义绝对时间…" }).click();
  const dialog = page.getByRole("dialog", { name: "自定义时间范围" });
  await expect(dialog).toBeVisible();

  await dialog.getByLabel("开始时间").fill("2026-09-01T10:00");
  await dialog.getByLabel("结束时间").fill("2026-09-01T12:30");
  await dialog.getByRole("button", { name: "应用时间" }).click();

  await expect(dialog).toBeHidden();
  await expect.poll(() => selectedDuration(page.url())).toBe(2.5 * 60 * 60 * 1000);
  await expect(page.getByRole("combobox", { name: "全局时间范围" })).toContainText("09/01");
});

function selectedDuration(url: string) {
  const search = new URL(url).searchParams;
  const from = new Date(search.get("from") ?? "");
  const to = new Date(search.get("to") ?? "");
  return to.getTime() - from.getTime();
}
