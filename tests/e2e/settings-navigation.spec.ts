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
  await expect(page.getByRole("navigation", { name: "设置 · 系统设置" })).toHaveCount(0);

  await page.goto(`/projects/${projectId}/overview`);
  await page.getByRole("button", { name: "打开账户菜单" }).click();
  await expect(page.getByRole("menuitem", { name: "系统设置" })).toHaveCount(0);
});

test("settings sit in the sidebar footer and system settings in the account menu", async ({
  page,
}) => {
  await mockOpenRUM(page, { projectExists: true, instanceRole: "instance_owner" });
  await page.goto(`/projects/${projectId}/overview`);

  const switcher = page.locator(".sidebar-nav-switcher");
  await expect(switcher).toHaveAttribute("data-level", "primary");
  const settingsEntry = page.getByRole("navigation", { name: "设置与快捷入口" }).getByRole("link", {
    name: "设置",
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
  await expect(page.getByRole("navigation", { name: "设置 · 系统设置" })).toHaveCount(0);
  const groupHeading = page.getByRole("heading", { name: "组织", exact: true });
  await expect
    .poll(() =>
      groupHeading.evaluate((element) => {
        const style = getComputedStyle(element);
        return { fontSize: style.fontSize, fontWeight: style.fontWeight };
      }),
    )
    .toEqual({ fontSize: "12px", fontWeight: "400" });
  await expect(groupHeading).toHaveCSS("white-space", "nowrap");
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
      const [activeStyle, inactiveStyle, groupColor] = await Promise.all([
        activeItem.evaluate((element) => {
          const style = getComputedStyle(element);
          return {
            background: style.backgroundColor,
            fontSize: style.fontSize,
            fontWeight: style.fontWeight,
          };
        }),
        inactiveItem.evaluate((element) => {
          const style = getComputedStyle(element);
          return { background: style.backgroundColor, color: style.color };
        }),
        groupHeading.evaluate((element) => getComputedStyle(element).color),
      ]);
      return {
        differentBackground: activeStyle.background !== inactiveStyle.background,
        differentColor: groupColor !== inactiveStyle.color,
        fontSize: activeStyle.fontSize,
        fontWeight: activeStyle.fontWeight,
      };
    })
    .toEqual({
      differentBackground: true,
      differentColor: true,
      fontSize: "14px",
      fontWeight: "500",
    });
  await page.screenshot({ path: "/tmp/openrum-secondary-nav-active.png" });

  // Account, organization and project settings stay together in this rail.
  await page.getByRole("link", { name: "数据管理", exact: true }).click();
  await page.getByRole("tab", { name: "隐私脱敏", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/settings/project/${projectId}/scrubbing$`));
  await expect(page.getByRole("link", { name: "数据管理", exact: true })).toHaveClass(/is-active/);

  await page.getByRole("link", { name: "成员与权限", exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/org\/members$/);

  await page.getByRole("link", { name: "返回设置", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/overview`));
  await expect(switcher).toHaveAttribute("data-level", "primary");
  await expect(page.getByRole("navigation", { name: "主导航" })).toBeVisible();

  await page.getByRole("button", { name: "打开账户菜单" }).click();
  await page.getByRole("menuitem", { name: "系统设置" }).click();
  await expect(page).toHaveURL(/\/settings\/instance$/);
  await expect(switcher).toHaveAttribute("data-level", "settings");
  await expect(page.getByRole("navigation", { name: "设置 · 系统设置" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "设置 · 项目" })).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "设置 · 账户" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "认证与访问", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "数据生命周期", exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/instance\/retention$/);

  await page.getByRole("link", { name: "返回控制台", exact: true }).click();
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

test("project deletion is confirmed by holding the button and returns to the list", async ({
  page,
}) => {
  await mockOpenRUM(page, { projectExists: true, role: "owner" });
  await page.goto(projectGeneralPath);

  const deleteButton = page.getByRole("button", { name: "长按删除项目 Magic Moment H5" });
  await expect(deleteButton).toBeEnabled();
  // A short press only starts the fill and must not delete anything.
  await deleteButton.focus();
  await page.keyboard.down("Enter");
  await page.waitForTimeout(500);
  await page.keyboard.up("Enter");
  await expect(page).toHaveURL(new RegExp(`${projectGeneralPath}$`));

  const deletion = page.waitForRequest(
    (request) =>
      request.method() === "DELETE" && request.url().endsWith(`/api/v1/projects/${projectId}`),
  );
  await page.keyboard.down("Enter");
  await deletion;
  await page.keyboard.up("Enter");
  await expect(page).toHaveURL(/\/projects$/);
});
