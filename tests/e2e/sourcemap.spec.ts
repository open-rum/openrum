import { expect, test } from "@playwright/test";
import { mockOpenRUM } from "./mockOpenRUM";

const mapBody = Buffer.from('{"version":3,"sources":["src/checkout/submit.ts"],"mappings":"AAAA"}');

test("release workflow uploads a hidden map and verifies an exact source position", async ({
  page,
}) => {
  await mockOpenRUM(page, { projectExists: true });
  await page.route("https://oss.example/**", (route) => route.fulfill({ status: 200 }));
  await page.goto("/releases");

  await expect(page.getByRole("heading", { name: "Release 与 Source Map" })).toBeVisible();
  // The artifact name is the URL path prefix plus the file's path relative to the build
  // output, never just the bare file name.
  await page.getByPlaceholder("例如 static/app/，站点根目录留空").fill("/static/app");
  await expect(page.getByTestId("artifact-name-example")).toHaveText(
    "static/app/assets/index-abc123.js.map",
  );
  await page.getByLabel("选择 Source Map 文件").setInputFiles([
    { name: "app.js.map", mimeType: "application/json", buffer: mapBody },
    { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("ignored") },
  ]);
  const queue = page.getByRole("list", { name: "上传队列" });
  await expect(queue.getByText("static/app/app.js.map")).toBeVisible();
  await expect(page.getByText(/忽略 1 个非 .map 文件/)).toBeVisible();
  await page.getByRole("button", { name: "上传 1 个文件" }).click();
  await expect(page.getByText(/可用 1，跳过 0，失败 0/)).toBeVisible();

  const artifacts = page.getByRole("table", { name: "已上传的 Source Map" });
  await expect(artifacts.getByText("static/app/app.js.map")).toBeVisible();
  await expect(artifacts.getByText("可用")).toBeVisible();

  // Re-uploading identical bytes is skipped rather than rejected.
  await page.getByLabel("选择 Source Map 文件").setInputFiles({
    name: "app.js.map",
    mimeType: "application/json",
    buffer: mapBody,
  });
  await page.getByRole("button", { name: "上传 1 个文件" }).click();
  await expect(page.getByText(/可用 0，跳过 1，失败 0/)).toBeVisible();

  // Different bytes under the same name need an explicit replacement.
  await page.getByLabel("选择 Source Map 文件").setInputFiles({
    name: "app.js.map",
    mimeType: "application/json",
    buffer: Buffer.from('{"version":3,"sources":["src/other.ts"],"mappings":"AAAA"}'),
  });
  await page.getByRole("button", { name: "上传 1 个文件" }).click();
  await expect(page.getByText(/该版本已有同名 Source Map/)).toBeVisible();
  await page.getByRole("button", { name: "替换" }).click();
  await expect(page.getByText(/可用 1，跳过 0，失败 0/)).toBeVisible();

  await page.getByLabel("列", { exact: true }).fill("482");
  await page.getByRole("button", { name: "测试匹配" }).click();
  await expect(page.getByText("src/checkout/submit.ts:42:11")).toBeVisible();
  if (process.env.OPENRUM_RELEASES_SCREENSHOT)
    await page.screenshot({ path: process.env.OPENRUM_RELEASES_SCREENSHOT, fullPage: true });
});

test("an Issue link preselects its release on the Releases page", async ({ page }) => {
  await mockOpenRUM(page, { projectExists: true });
  await page.goto(
    `/projects/018f4d9c-83a1-76c9-81c2-3020ab667090/releases?release=${encodeURIComponent("web@2026.09.03")}&dist=browser`,
  );
  await expect(page.getByRole("button", { name: "长按删除版本 web@2026.09.03" })).toBeVisible();
  await expect(page.getByLabel("版本列表").locator('button[aria-current="true"]')).toContainText(
    "web@2026.09.03",
  );
});
