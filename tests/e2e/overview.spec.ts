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
