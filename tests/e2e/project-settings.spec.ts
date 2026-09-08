import { expect, test } from "@playwright/test";
import { mockOpenRUM, projectId } from "./mockOpenRUM";

const settingsPath = `/projects/${projectId}/settings`;

test("an origin can be added after the project was created", async ({ page }) => {
  await mockOpenRUM(page, { projectExists: true, role: "admin" });
  await page.goto(settingsPath);
  await expect(page.getByRole("heading", { name: "项目设置" })).toBeVisible();

  const origins = page.getByLabel("允许的 Origin");
  await expect(origins).toHaveValue("http://127.0.0.1:4174");
  await origins.fill("http://127.0.0.1:4174\nhttps://www.example.com");
  await page.getByRole("button", { name: "保存设置" }).click();
  await expect(page.getByRole("status")).toContainText("已保存");

  // Reloading proves the new origin was sent and accepted, not just held in
  // component state: the form re-reads it from the project response.
  await page.reload();
  await expect(page.getByLabel("允许的 Origin")).toHaveValue(
    "http://127.0.0.1:4174\nhttps://www.example.com",
  );
});

test("changing the environment warns that it must match the SDK", async ({ page }) => {
  await mockOpenRUM(page, { projectExists: true, role: "owner" });
  await page.goto(settingsPath);
  await expect(page.getByText("上报会被 Ingest 拒绝")).toBeVisible();
  const environment = page.getByLabel("环境");
  await expect(environment).toHaveValue("production");
  await environment.fill("staging");
  await page.getByRole("button", { name: "保存设置" }).click();
  await expect(page.getByRole("status")).toContainText("已保存");
  await page.reload();
  await expect(page.getByLabel("环境")).toHaveValue("staging");
});

test("a noisy project can be disabled and brought back", async ({ page }) => {
  await mockOpenRUM(page, { projectExists: true, role: "owner" });
  await page.goto(settingsPath);
  page.on("dialog", (dialog) => void dialog.accept());

  await page.getByRole("button", { name: "停用项目" }).click();
  await expect(page.getByRole("heading", { name: "项目已停用" })).toBeVisible();
  await expect(page.getByRole("button", { name: "恢复项目" })).toBeVisible();

  await page.getByRole("button", { name: "恢复项目" }).click();
  await expect(page.getByRole("heading", { name: "停用项目" })).toBeVisible();
});

test("a failed save reports that nothing changed", async ({ page }) => {
  await mockOpenRUM(page, { projectExists: true, role: "owner", failProjectPatch: true });
  await page.goto(settingsPath);
  await page.getByLabel("项目名称").fill("Renamed");
  await page.getByRole("button", { name: "保存设置" }).click();
  await expect(page.getByRole("alert")).toContainText("项目设置未改变");
});

test("members see the settings read-only", async ({ page }) => {
  await mockOpenRUM(page, { projectExists: true, role: "member" });
  await page.goto(settingsPath);
  await expect(page.getByText("只有 Owner 或 Admin 可以修改项目设置")).toBeVisible();
  await expect(page.getByRole("button", { name: "保存设置" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "停用项目" })).toBeDisabled();
});

test("settings and write keys are reachable from each other", async ({ page }) => {
  await mockOpenRUM(page, { projectExists: true, role: "owner" });
  await page.goto(settingsPath);
  await page.getByRole("link", { name: "Write Keys" }).click();
  await expect(page.getByRole("heading", { name: "项目 Write Keys" })).toBeVisible();
  await page.getByRole("link", { name: "常规" }).click();
  await expect(page.getByRole("heading", { name: "项目设置" })).toBeVisible();
});

const filtersPath = `/projects/${projectId}/settings/filters`;

test("a category can be set to measure before it drops anything", async ({ page }) => {
  await mockOpenRUM(page, { projectExists: true, role: "owner" });
  await page.goto(filtersPath);
  await expect(page.getByRole("heading", { name: "入站过滤" })).toBeVisible();

  // Nothing filters until somebody opts in, so every category starts off.
  const bot = page.getByLabel("机器人流量 的处理方式");
  await expect(bot).toHaveValue("off");
  await bot.selectOption("dry_run");
  await page.getByRole("button", { name: "保存" }).click();
  await expect(page.getByRole("status")).toContainText("已保存");

  // Reloading proves the choice reached the server rather than living in
  // component state.
  await page.reload();
  await expect(page.getByLabel("机器人流量 的处理方式")).toHaveValue("dry_run");
});

test("a new custom rule starts by measuring", async ({ page }) => {
  await mockOpenRUM(page, { projectExists: true, role: "owner" });
  await page.goto(filtersPath);
  await expect(page.getByText("还没有自定义规则")).toBeVisible();

  await page.getByRole("button", { name: "添加规则" }).click();
  // Adding a rule must not be able to lose data before its author has seen
  // what it matches.
  await expect(page.getByLabel("规则 1 的处理方式")).toHaveValue("dry_run");
  await page.getByLabel("规则 1 的匹配模式").fill("ResizeObserver loop*");
  await page.getByRole("button", { name: "保存" }).click();
  await expect(page.getByRole("status")).toContainText("已保存");

  await page.reload();
  await expect(page.getByLabel("规则 1 的匹配模式")).toHaveValue("ResizeObserver loop*");
});

test("a member cannot change filters", async ({ page }) => {
  await mockOpenRUM(page, { projectExists: true, role: "member" });
  await page.goto(filtersPath);
  await expect(page.getByText("只有 Owner 或 Admin 可以修改过滤设置")).toBeVisible();
  await expect(page.getByLabel("机器人流量 的处理方式")).toBeDisabled();
  await expect(page.getByRole("button", { name: "保存" })).toBeDisabled();
});
