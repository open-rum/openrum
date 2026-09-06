import { expect, test } from "@playwright/test";
import { mockOpenRUM } from "./mockOpenRUM";

test("release workflow uploads a hidden map and verifies an exact source position", async ({
  page,
}) => {
  await mockOpenRUM(page, { projectExists: true });
  await page.route("https://oss.example/**", (route) => route.fulfill({ status: 200 }));
  await page.goto("/releases");

  await expect(page.getByRole("heading", { name: "Release 与 Source Map" })).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles({
    name: "assets-app.js.map",
    mimeType: "application/json",
    buffer: Buffer.from('{"version":3,"sources":["src/checkout/submit.ts"],"mappings":"AAAA"}'),
  });
  await expect(page.getByText("assets/app.js.map")).toBeVisible();
  await expect(page.getByText("可用")).toBeVisible();

  await page.getByLabel("列").fill("482");
  await page.getByRole("button", { name: "测试匹配" }).click();
  await expect(page.getByText("src/checkout/submit.ts:42:11")).toBeVisible();
  if (process.env.OPENRUM_RELEASES_SCREENSHOT)
    await page.screenshot({ path: process.env.OPENRUM_RELEASES_SCREENSHOT, fullPage: true });
});
