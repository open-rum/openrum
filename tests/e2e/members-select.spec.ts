import { expect, test } from "@playwright/test";
import { mockOpenRUM } from "./mockOpenRUM";

const organizationId = "018f4d9c-83a1-76c9-81c2-3020ab667091";
const ownerId = "018f4d9c-83a1-76c9-81c2-3020ab667092";
const teammateId = "018f4d9c-83a1-76c9-81c2-3020ab667093";
const joinedAt = "2026-09-03T00:00:00.000Z";

test("member selects keep invitation and role changes working", async ({ page }) => {
  await mockOpenRUM(page, { projectExists: true });
  const members = [
    {
      userId: ownerId,
      email: "e2e@openrum.local",
      displayName: "E2E Owner",
      role: "owner",
      createdAt: joinedAt,
      updatedAt: joinedAt,
    },
    {
      userId: teammateId,
      email: "teammate@openrum.local",
      displayName: "Teammate",
      role: "member",
      createdAt: joinedAt,
      updatedAt: joinedAt,
    },
  ];
  let invitation: { email: string; role: string } | undefined;
  let changedRole: string | undefined;
  await page.route(`**/api/v1/organizations/${organizationId}/members**`, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === `/api/v1/organizations/${organizationId}/members`) {
      if (request.method() === "POST") {
        invitation = request.postDataJSON() as { email: string; role: string };
        const member = {
          userId: "018f4d9c-83a1-76c9-81c2-3020ab667094",
          email: invitation.email,
          displayName: "Invited user",
          role: invitation.role,
          createdAt: joinedAt,
          updatedAt: joinedAt,
        };
        members.push(member);
        return route.fulfill({ status: 201, json: member });
      }
      return route.fulfill({ json: { members } });
    }
    if (path.endsWith(`/${teammateId}`) && request.method() === "PATCH") {
      changedRole = (request.postDataJSON() as { role: string }).role;
      members[1] = { ...members[1], role: changedRole };
      return route.fulfill({ json: members[1] });
    }
    return route.fallback();
  });

  await page.goto("/settings/org/members");
  await expect(page.getByRole("heading", { name: "成员与权限" })).toBeVisible();

  const organization = page.getByRole("combobox", { name: "组织" });
  await organization.focus();
  await page.keyboard.press("Enter");
  const listbox = page.getByRole("listbox");
  await expect(listbox).toBeVisible();
  const triggerBounds = await page.locator("#members-organization").boundingBox();
  const menuBounds = await listbox.boundingBox();
  expect(triggerBounds).not.toBeNull();
  expect(menuBounds).not.toBeNull();
  expect(menuBounds!.y).toBeGreaterThanOrEqual(triggerBounds!.y + triggerBounds!.height);
  await page.keyboard.press("Escape");

  await page.getByRole("combobox", { name: "角色", exact: true }).click();
  await page.getByRole("option", { name: "Admin" }).click();
  await page.getByRole("textbox", { name: "已有用户邮箱" }).fill("new@openrum.local");
  await page.getByRole("button", { name: "添加成员" }).click();
  await expect.poll(() => invitation).toEqual({ email: "new@openrum.local", role: "admin" });
  await expect(page.getByText("new@openrum.local")).toBeVisible();

  await page.getByRole("combobox", { name: "修改 Teammate 的角色" }).click();
  await page.getByRole("option", { name: "Viewer" }).click();
  await expect.poll(() => changedRole).toBe("viewer");
  await expect(page.getByRole("combobox", { name: "修改 Teammate 的角色" })).toContainText(
    "Viewer",
  );
});

test("admins cannot edit an Owner or grant Owner in the invite form", async ({ page }) => {
  await mockOpenRUM(page, { projectExists: true, role: "admin" });
  await page.goto("/settings/org/members");
  await expect(page.getByRole("combobox", { name: "修改 E2E Owner 的角色" })).toBeDisabled();
  await page.getByRole("combobox", { name: "角色", exact: true }).click();
  await expect(page.getByRole("option", { name: "Owner" })).toHaveCount(0);
  await expect(page.getByRole("option", { name: "Admin" })).toBeVisible();
});

test("long select menus scroll within the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 420 });
  await mockOpenRUM(page, { projectExists: true });
  await page.route("**/api/v1/organizations", (route) =>
    route.fulfill({
      json: {
        organizations: Array.from({ length: 25 }, (_, index) => ({
          id:
            index === 0
              ? organizationId
              : `018f4d9c-83a1-76c9-81c2-3020ab6670${String(index).padStart(2, "0")}`,
          name: `Org ${index}`,
          slug: `org-${index}`,
          role: "owner",
          createdAt: joinedAt,
          updatedAt: joinedAt,
        })),
      },
    }),
  );

  await page.goto("/settings/org/members");
  await page.getByRole("combobox", { name: "组织" }).click();
  const menu = page.locator('[data-slot="select-content"]');
  await expect(menu).toBeVisible();
  const menuBounds = await menu.boundingBox();
  expect(menuBounds).not.toBeNull();
  expect(menuBounds!.y).toBeGreaterThanOrEqual(0);
  expect(menuBounds!.y + menuBounds!.height).toBeLessThanOrEqual(420);
  await page.getByRole("option", { name: /Org 24/ }).scrollIntoViewIfNeeded();
  await expect(page.getByRole("option", { name: /Org 24/ })).toBeVisible();
});
