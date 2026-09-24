import { expect, test } from "@playwright/test";
import { mockOpenRUM, projectId } from "./mockOpenRUM";

// Settings moved from three separate navigations onto one `/settings` shell whose first
// path segment names the scope. The old addresses are in the documentation, in bookmarks
// and in links people sent each other, so every one of them has to keep resolving —
// these assertions are the contract, not the implementation.

const projectGeneralPath = `/settings/project/${projectId}/general`;

test("every legacy project settings address redirects to its scoped home", async ({ page }) => {
  await mockOpenRUM(page, { projectExists: true, role: "owner" });

  const moves = [
    ["", "general"],
    ["/keys", "/keys"],
    ["/filters", "/filters"],
    ["/url-rules", "/url-rules"],
    ["/scrubbing", "/scrubbing"],
    ["/quota", "/quota"],
  ] as const;

  for (const [suffix, destination] of moves) {
    await page.goto(`/projects/${projectId}/settings${suffix}`);
    const expected =
      destination === "general"
        ? `/settings/project/${projectId}/general`
        : `/settings/project/${projectId}${destination}`;
    await expect(page).toHaveURL(new RegExp(`${expected.replace(/\//g, "\\/")}$`));
  }
});

test("legacy account and organization addresses redirect", async ({ page }) => {
  await mockOpenRUM(page, { projectExists: true, role: "owner" });

  await page.goto("/account");
  await expect(page).toHaveURL(/\/settings\/account$/);

  await page.goto("/settings/channels");
  await expect(page).toHaveURL(/\/settings\/org\/channels$/);

  // Bare `/settings` used to render the member list. It keeps that destination rather
  // than becoming a landing page, so an existing bookmark lands where it always did.
  await page.goto("/settings");
  await expect(page).toHaveURL(/\/settings\/org\/members$/);
  await expect(page.getByRole("heading", { name: "成员与权限" })).toBeVisible();
});

test("legacy admin addresses redirect and keep their instance-role gate", async ({ page }) => {
  await mockOpenRUM(page, { projectExists: true, instanceRole: "instance_owner" });

  await page.goto("/admin/data-retention");
  await expect(page).toHaveURL(/\/settings\/instance\/retention$/);
  await expect(page.getByRole("heading", { name: "数据生命周期" })).toBeVisible();

  await page.goto("/admin");
  await expect(page).toHaveURL(/\/settings\/instance$/);
});

test("a user without an instance role cannot reach the instance scope", async ({ page }) => {
  await mockOpenRUM(page, { projectExists: true });

  // The gate lives on the new route, so it has to survive the redirect hop as well as a
  // direct visit to the new address.
  await page.goto("/admin/object-storage");
  await expect(page).toHaveURL(/\/projects$/);

  await page.goto("/settings/instance/retention");
  await expect(page).toHaveURL(/\/projects$/);

  await page.goto(`/settings/project/${projectId}/general`);
  await expect(page.getByRole("navigation", { name: "设置 · 账户" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "设置 · 实例" })).toHaveCount(0);
});

test("settings replaces the primary sidebar and reaches all four scopes", async ({ page }) => {
  await mockOpenRUM(page, { projectExists: true, instanceRole: "instance_owner" });
  await page.goto(`/projects/${projectId}/overview`);

  const switcher = page.locator(".sidebar-nav-switcher");
  await expect(switcher).toHaveAttribute("data-level", "primary");
  const settingsEntry = page.getByRole("navigation", { name: "主导航" }).getByRole("link", {
    name: "项目设置",
    exact: true,
  });
  await expect(settingsEntry.locator(".nav-item__next")).toBeVisible();
  await page.getByRole("button", { name: "收起侧边栏" }).click();
  await expect(page.locator(".app-shell")).toHaveAttribute("data-sidebar-state", "collapsed");
  await settingsEntry.click();
  await expect(page).toHaveURL(new RegExp(`${projectGeneralPath}$`));
  await expect(page.locator(".app-shell")).toHaveAttribute("data-sidebar-state", "expanded");
  await expect(switcher).toHaveAttribute("data-level", "settings");
  await expect(page.getByRole("navigation", { name: "主导航" })).not.toBeVisible();
  await expect(page.getByRole("link", { name: "返回设置", exact: true })).toBeVisible();
  const groupHeading = page.getByRole("heading", { name: "组织", exact: true });
  await expect
    .poll(() =>
      groupHeading.evaluate((element) => {
        const style = getComputedStyle(element);
        return { fontSize: style.fontSize, fontWeight: style.fontWeight };
      }),
    )
    .toEqual({ fontSize: "13px", fontWeight: "400" });
  await expect
    .poll(() =>
      groupHeading.evaluate(
        (element) => getComputedStyle(element.closest("section")!).borderBottomStyle,
      ),
    )
    .toBe("solid");
  const activeItem = page.getByRole("link", { name: "常规", exact: true });
  await expect(page.getByRole("link", { name: "客户端 DSN", exact: true })).toHaveCount(0);
  const inactiveItem = page.getByRole("link", { name: "接入指引", exact: true });
  await expect(activeItem).toHaveClass(/is-active/);
  await expect
    .poll(async () => {
      const [activeStyle, inactiveStyle] = await Promise.all([
        activeItem.evaluate((element) => {
          const style = getComputedStyle(element);
          return {
            background: style.backgroundColor,
            fontSize: style.fontSize,
            fontWeight: style.fontWeight,
          };
        }),
        inactiveItem.evaluate((element) => getComputedStyle(element).backgroundColor),
      ]);
      return {
        differentBackground: activeStyle.background !== inactiveStyle,
        fontSize: activeStyle.fontSize,
        fontWeight: activeStyle.fontWeight,
      };
    })
    .toEqual({
      differentBackground: true,
      fontSize: "13px",
      fontWeight: "400",
    });
  await page.screenshot({ path: "/tmp/openrum-secondary-nav-active.png" });

  // Project scope, then across to the organization and the instance without restoring
  // the primary menu between settings pages.
  await page.getByRole("link", { name: "数据管理", exact: true }).click();
  await page.getByRole("tab", { name: "隐私脱敏", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/settings/project/${projectId}/scrubbing$`));
  await expect(page.getByRole("link", { name: "数据管理", exact: true })).toHaveClass(/is-active/);

  await page.getByRole("link", { name: "成员与权限", exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/org\/members$/);

  await page.getByRole("link", { name: "数据生命周期", exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/instance\/retention$/);

  await page.getByRole("link", { name: "返回设置", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/overview`));
  await expect(switcher).toHaveAttribute("data-level", "primary");
  await expect(page.getByRole("navigation", { name: "主导航" })).toBeVisible();
});

test("a saved collapsed preference cannot hide a directly opened secondary menu", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("openrum-sidebar-collapsed", "true");
  });
  await mockOpenRUM(page, { projectExists: true, role: "owner" });
  await page.goto(projectGeneralPath);

  await expect(page.locator(".app-shell")).toHaveAttribute("data-sidebar-state", "expanded");
  await expect(page.getByRole("navigation", { name: "设置 · 项目" })).toBeVisible();
});

test("project usage lives in project settings while releases stay in the main navigation", async ({
  page,
}) => {
  await mockOpenRUM(page, { projectExists: true, role: "owner" });
  await page.goto(`/projects/${projectId}/overview`);

  const mainNav = page.getByRole("navigation", { name: "主导航" });
  await mainNav.getByRole("link", { name: "发布", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/releases$`));
  // They are reports, so they no longer carry the settings rail.
  await expect(page.getByRole("navigation", { name: "设置 · 项目" })).toHaveCount(0);

  await expect(mainNav.getByRole("link", { name: "用量", exact: true })).toHaveCount(0);
  await mainNav.getByRole("link", { name: "项目设置", exact: true }).click();
  const projectSettings = page.getByRole("navigation", { name: "设置 · 项目" });
  await projectSettings.getByRole("link", { name: "用量统计", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/settings/project/${projectId}/usage$`));
  await expect(page.getByRole("heading", { name: "用量统计", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "保存采样配置" })).toHaveCount(0);
  await page.getByRole("link", { name: "配置采样", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/settings/project/${projectId}/sampling$`));
  await expect(page.getByRole("heading", { name: "采样配置", exact: true })).toBeVisible();
});

test("legacy project usage links keep their filters when redirected into settings", async ({
  page,
}) => {
  await mockOpenRUM(page, { projectExists: true, role: "owner" });
  await page.goto(
    `/projects/${projectId}/usage?from=2026-09-20T00%3A00%3A00.000Z&to=2026-09-21T00%3A00%3A00.000Z&eventType=error`,
  );
  await expect(page).toHaveURL(
    new RegExp(`/settings/project/${projectId}/usage\\?.*eventType=error`),
  );
});

test("project data deletion requires a disabled project and typed confirmation", async ({
  page,
}) => {
  await mockOpenRUM(page, { projectExists: true, role: "owner" });
  await page.goto(projectGeneralPath);

  const purgeButton = page.getByRole("button", { name: "清空全部数据" });
  await expect(purgeButton).toBeDisabled();
  page.once("dialog", (dialog) => dialog.accept());
  // The native confirmation is created synchronously by the click handler.
  await page.getByRole("button", { name: "停用项目" }).click();
  await expect(page.getByText("项目已停用")).toBeVisible();
  await expect(purgeButton).toBeEnabled();

  await purgeButton.click();
  const dialog = page.getByRole("alertdialog");
  const confirmButton = dialog.getByRole("button", { name: "确认清空" });
  await expect(confirmButton).toBeDisabled();
  await dialog.getByLabel("项目名称").fill("Magic Moment H5");
  await expect(confirmButton).toBeEnabled();
  await confirmButton.click();
  await expect(page.getByText(/正在异步清空数据/)).toBeVisible();
  await expect(page.getByRole("button", { name: "恢复项目" })).toBeDisabled();
});
