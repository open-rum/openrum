import { expect, test } from "@playwright/test";
import { mockOpenRUM, projectId } from "./mockOpenRUM";

test("overview records a local viewed milestone without recursive ingest", async ({ page }) => {
  const { ingestRequests } = await mockOpenRUM(page, { projectExists: true });
  await page.goto(`/projects/${projectId}/overview`);
  await expect(page.getByRole("heading", { name: "生产环境概览" })).toBeVisible();
  await expect(page.getByRole("region", { name: "核心指标" })).toBeVisible();
  const names = await page.evaluate(() =>
    JSON.parse(sessionStorage.getItem("openrum:product-events:v1") ?? "[]").map(
      (event: { name: string }) => event.name,
    ),
  );
  expect(names).toContain("overview_viewed");
  expect(ingestRequests).toEqual([]);
});

test("the dashboard is the landing surface and the first primary nav entry", async ({ page }) => {
  await mockOpenRUM(page, { projectExists: true });
  await page.goto("/");
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/overview(?:\\?.*)?$`));

  const primary = page.getByRole("navigation", { name: "主导航" });
  const first = primary.getByRole("link").first();
  await expect(first).toHaveText("数据大盘");

  // Leaving and coming back has to work, which is what the missing nav entry
  // used to prevent.
  await primary.getByRole("link", { name: "错误" }).click();
  await expect(page).toHaveURL(/\/issues(?:\?.*)?$/);
  await first.click();
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/overview(?:\\?.*)?$`));
});

test("every trend panel renders, including the previously unplotted series", async ({ page }) => {
  await mockOpenRUM(page, { projectExists: true });
  await page.goto(`/projects/${projectId}/overview`);

  await expect(page.getByRole("img", { name: "PV 与 UV 时间趋势" })).toBeVisible();
  await expect(page.getByRole("img", { name: "错误率与 API 失败率时间趋势" })).toBeVisible();
  for (const metric of ["LCP", "INP", "CLS"]) {
    await expect(page.getByRole("img", { name: `${metric} P75 日期趋势` })).toBeVisible();
  }
});

test("the trend table is the non-visual equivalent of the charts", async ({ page }) => {
  await mockOpenRUM(page, { projectExists: true });
  await page.goto(`/projects/${projectId}/overview`);

  const table = page.getByRole("table");
  await expect(table).toBeHidden();
  await page.getByText("查看趋势表格数据").click();
  await expect(table.getByRole("columnheader", { name: "API 失败率" })).toBeVisible();
  await expect(table.getByRole("columnheader", { name: "LCP P75" })).toBeVisible();
  await expect(table.getByRole("columnheader", { name: "CLS P75" })).toBeVisible();
});

test("KPI cards show the previous period value next to the delta", async ({ page }) => {
  await mockOpenRUM(page, { projectExists: true });
  await page.goto(`/projects/${projectId}/overview`);

  const cards = page.getByRole("region", { name: "核心指标" });
  await expect(cards.getByText(/^上一周期/).first()).toBeVisible();
});
