import { expect, test } from "@playwright/test";
import { mockOpenRUM } from "./mockOpenRUM";

test("API filters narrow the list by method and endpoint search", async ({ page }) => {
  await mockOpenRUM(page, { projectExists: true });
  await page.goto("/apis");

  const filterSearch = page.getByRole("combobox", { name: "搜索 API 或添加筛选条件" });
  await filterSearch.click();
  await page.getByRole("button", { name: "POST", exact: true }).click();
  await expect(page).toHaveURL(/methods=POST/);

  await filterSearch.fill("orders");
  await page.getByRole("button", { name: "查询" }).click();
  await expect(page).toHaveURL(/search=orders/);
  await expect(page.getByText("Endpoint：orders", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "移除筛选：Endpoint：orders" }).click();
  await page.getByRole("button", { name: "移除筛选：方法：POST" }).click();
  await expect(page).not.toHaveURL(/search=orders/);
});
