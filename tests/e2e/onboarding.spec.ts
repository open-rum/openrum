import { expect, test } from "@playwright/test";
import { mockOpenRUM, projectId } from "./mockOpenRUM";

test("project creation reaches the queryable overview magic moment in under five minutes", async ({
  page,
}) => {
  const { ingestRequests } = await mockOpenRUM(page);
  const startedAt = Date.now();

  await page.goto("/onboarding");
  await page.getByLabel("项目名称").fill("Magic Moment H5");
  await page.getByLabel("项目 Slug").fill("magic-moment-h5");
  await page.getByLabel("允许的 Origin").fill("http://127.0.0.1:4174");
  await page.getByRole("button", { name: "创建项目" }).click();

  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/onboarding`));
  await expect(page.getByRole("heading", { name: "连接第一个真实页面" })).toBeVisible();
  await page.getByRole("button", { name: "发送测试事件" }).click();
  const dashboardLink = page.getByRole("link", { name: "进入数据大盘" });
  await expect(dashboardLink).toBeEnabled();
  await expect(dashboardLink).toHaveCSS("color", "oklch(0 0 0)");

  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(dashboardLink).toHaveCSS("color", "oklch(0 0 0)");

  await dashboardLink.click();

  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/overview`));
  await expect(page.getByRole("region", { name: "核心指标" })).toBeVisible();
  const timeline = await page.evaluate(() =>
    JSON.parse(sessionStorage.getItem("openrum:product-events:v1") ?? "[]"),
  );
  expect(timeline.map((event: { name: string }) => event.name)).toEqual([
    "project_created",
    "first_event_queryable",
    "overview_viewed",
  ]);
  expect(Date.now() - startedAt).toBeLessThan(5 * 60_000);
  expect(ingestRequests).toEqual([]);
});

test("onboarding offers a bundler-free Instance CDN snippet", async ({ page }) => {
  await mockOpenRUM(page, { projectExists: true });
  await page.goto(`/projects/${projectId}/onboarding`);

  await expect(page.getByRole("heading", { name: "连接第一个真实页面" })).toBeVisible();
  await page.getByRole("tab", { name: "CDN 脚本" }).click();
  const cdnPanel = page.getByRole("tabpanel", { name: "CDN 脚本" });
  await expect(cdnPanel).toContainText("OpenRUM.init");
  await expect(cdnPanel).toContainText("/sdk/browser/0.1.0/openrum.min.js");
  await expect(cdnPanel).toContainText("script.onload");
  await page.getByRole("tab", { name: "同步加载" }).click();
  await expect(cdnPanel).not.toContainText("script.onload");
  await cdnPanel.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "/tmp/openrum-onboarding-cdn.png", fullPage: false });
});
