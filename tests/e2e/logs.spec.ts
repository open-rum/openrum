import { expect, test, type Page } from "@playwright/test";
import { mockOpenRUM, projectId } from "./mockOpenRUM";
import type { LogEntry, LogPage } from "../../apps/web/src/lib/api/logs";

const from = "2026-09-12T10:00:00.000Z";
const to = "2026-09-12T11:00:00.000Z";
const levels = ["info", "warn", "error", "debug", "trace", "fatal"] as const;
const items: LogEntry[] = Array.from({ length: 14 }, (_, index) => ({
  eventId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  timestamp: `2026-09-12T10:${String(59 - index).padStart(2, "0")}:23.180Z`,
  level: levels[index % levels.length],
  message: [
    "checkout started",
    "payment retry scheduled",
    "payment failed: upstream timeout",
    "cart cache hit",
    "checkout render started",
    "checkout initialization failed",
  ][index % levels.length],
  logger: index % 3 ? "payment" : "checkout",
  environment: "production",
  release: "web@2026.09.3",
  route: "/checkout",
  pageUrl: "https://shop.example.com/checkout",
  browser: "Chrome",
  deviceType: "desktop",
  country: "CN",
  sessionId: "00000000-0000-4000-8000-000000001234",
  userId: index === 0 ? "" : index % 2 ? "customer-456" : "customer-123",
  anonymousUserId: index % 2 ? "visitor-def" : "visitor-abc",
  traceId: "0123456789abcdef0123456789abcdef",
  spanId: "0123456789abcdef",
  attributes: { "order.id": "order-demo-123", "payment.provider": "demo", "retry.attempt": "2" },
  sampleRate: 1,
}));
const data: LogPage = {
  items,
  total: 1238,
  nextCursor: "older-page",
  intervalSeconds: 60,
  trend: Array.from({ length: 60 }, (_, i) => ({
    bucket: `2026-09-12T10:${String(i).padStart(2, "0")}:00.000Z`,
    trace: i % 3,
    debug: i % 4,
    info: 8 + (i % 9),
    warn: i % 6,
    error: i > 35 && i < 45 ? 8 : i % 2,
    fatal: i === 40 ? 2 : 0,
  })),
};

async function setup(page: Page, extraParams = new URLSearchParams()) {
  await mockOpenRUM(page, { projectExists: true });
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
  const requests: URL[] = [];
  await page.route(/\/api\/v1\/projects\/[^/]+\/logs\?/, async (route) => {
    const url = new URL(route.request().url());
    requests.push(url);
    const q = url.searchParams.get("q") ?? "";
    if (q === "broken")
      return route.fulfill({
        status: 503,
        json: { error: { code: "QUERY_UNAVAILABLE", message: "Narrow the range" } },
      });
    const level = url.searchParams.get("level");
    const userId = q.match(/(?:^|\s)(?:user\.id|user_id|userId):"([^"]+)"/)?.[1];
    const visitorId = q.match(/anonymous_user_id:"([^"]+)"/)?.[1];
    const matching = items.filter(
      (item) =>
        (!level || item.level === level) &&
        (!userId || item.userId === userId) &&
        (!visitorId || item.anonymousUserId === visitorId),
    );
    const subset =
      q === "nothing"
        ? []
        : url.searchParams.has("cursor")
          ? [{ ...items[2], message: "older checkout log" }]
          : matching;
    return route.fulfill({
      json: {
        ...data,
        items: subset,
        total: q === "nothing" ? 0 : userId || visitorId ? matching.length : data.total,
        nextCursor: url.searchParams.has("cursor") || !subset.length ? "" : data.nextCursor,
      },
    });
  });
  await page.goto(
    `/projects/${projectId}/logs?from=${from}&to=${to}&environment=production&${extraParams}`,
  );
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/logs\\?`));
  await expect(page.getByRole("heading", { name: "日志", exact: true })).toBeVisible();
  await expect(page.getByRole("table", { name: "日志列表" })).toBeVisible();
  await expect(page.locator("vite-error-overlay")).toHaveCount(0);
  await expect(page.getByRole("group", { name: "全局分析筛选", exact: true })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "维度筛选侧栏" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^(收起筛选|筛选)$/ })).toHaveCount(0);
  await expect(page.locator(".analysis-filter-workspace")).toHaveCount(0);
  return requests;
}

test("full-width logs search, pagination, detail, export and history stay scoped", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  const requests = await setup(page);
  await expect(page.getByRole("img", { name: "日志量趋势" })).toBeVisible();
  const searchBounds = await page.locator("[data-console-filter-bar]").boundingBox();
  const cards = page.locator('[data-slot="card"]').filter({
    has: page
      .getByRole("img", { name: "日志量趋势" })
      .or(page.getByRole("table", { name: "日志列表" })),
  });
  await expect(cards).toHaveCount(2);
  for (const card of await cards.all()) {
    const bounds = await card.boundingBox();
    expect(bounds?.x).toBeCloseTo(searchBounds!.x, 0);
    expect(bounds?.width).toBeCloseTo(searchBounds!.width, 0);
  }
  await page.screenshot({ path: "/tmp/openrum-logs-no-sidebar-light.png", fullPage: true });
  await page.getByRole("button", { name: "切换至暗色模式", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.screenshot({ path: "/tmp/openrum-logs-no-sidebar-dark.png", fullPage: true });
  await page
    .getByRole("button", { name: "payment failed: upstream timeout", exact: true })
    .first()
    .click();
  const detail = page.getByRole("dialog", { name: "日志详情" });
  await expect(detail).toContainText("order-demo-123");
  await expect(detail.getByRole("link", { name: "查看关联会话" })).toHaveAttribute(
    "href",
    /sessions\/00000000-0000-4000-8000-000000001234\?.*event=00000000/,
  );
  await page.screenshot({ path: "/tmp/openrum-logs-no-sidebar-detail.png" });
  await detail.getByRole("button", { name: "按 order.id 筛选", exact: true }).click();
  await expect(detail).not.toBeVisible();
  const search = page.getByRole("textbox", { name: "搜索日志或添加筛选条件" });
  await expect(page.getByText("attributes.order.id：order-demo-123")).toBeVisible();
  await search.click();
  await page.getByRole("button", { name: /^日志级别/ }).click();
  await page.getByRole("button", { name: "ERROR", exact: true }).click();
  await expect.poll(() => requests.at(-1)?.searchParams.get("level")).toBe("error");
  const scopedQuery = 'attributes.order.id:"order-demo-123" route:"/checkout"';
  await page.getByRole("button", { name: "移除筛选：attributes.order.id：order-demo-123" }).click();
  await search.fill(scopedQuery);
  await page.getByRole("button", { name: "查询", exact: true }).click();
  await expect.poll(() => requests.at(-1)?.searchParams.get("q")).toBe(scopedQuery);
  expect(requests.at(-1)?.searchParams.has("route")).toBe(false);
  await page.getByRole("button", { name: "更早日志", exact: true }).click();
  await expect(page.getByRole("button", { name: "older checkout log" })).toBeVisible();
  await expect(page.getByRole("button", { name: "更早日志", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "回到最新", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "payment failed: upstream timeout" }).first(),
  ).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出本页" }).click();
  expect((await download).suggestedFilename()).toBe("openrum-logs-page.jsonl");
  await page.reload();
  await expect(page.getByText("attributes.order.id：order-demo-123")).toBeVisible();
  await expect(page.getByText("Route：/checkout")).toBeVisible();
  expect(
    requests.every(
      (url) =>
        url.pathname.includes(projectId) &&
        url.searchParams.get("environment") === "production" &&
        url.searchParams.get("from") === from &&
        url.searchParams.get("to") === to,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("logs empty, failure and mobile search states remain usable without dimension filters", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const requests = await setup(page);
  await page.screenshot({ path: "/tmp/openrum-logs-no-sidebar-mobile.png", fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  const search = page.getByRole("textbox", { name: "搜索日志或添加筛选条件" });
  await search.click();
  await page.getByRole("button", { name: /^日志级别/ }).click();
  await page.getByRole("button", { name: "WARN", exact: true }).click();
  await expect.poll(() => requests.at(-1)?.searchParams.get("level")).toBe("warn");
  await search.fill("nothing");
  await page.getByRole("button", { name: "查询", exact: true }).click();
  await expect(page.getByText("当前范围没有日志", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "移除筛选：正文：nothing" }).click();
  await search.fill("broken");
  await page.getByRole("button", { name: "查询", exact: true }).click();
  await expect(page.getByText("日志加载失败", { exact: true })).toBeVisible();
  await expect(page.getByText("正文：broken")).toBeVisible();
});

test("legacy sidebar links cannot apply invisible dimensions or a stale cursor", async ({
  page,
}) => {
  const obsolete = {
    country: "CN",
    deviceType: "mobile",
    route: "/checkout",
    browser: "Chrome",
    release: "web@1",
    cursor: "older-page",
  };
  const query = 'attributes.order.id:"order-demo-123" trace_id:"0123456789abcdef0123456789abcdef"';
  const requests = await setup(
    page,
    new URLSearchParams({ ...obsolete, q: query, level: "error" }),
  );
  for (const key of Object.keys(obsolete)) {
    await expect.poll(() => new URL(page.url()).searchParams.has(key)).toBe(false);
    expect(requests.every((request) => !request.searchParams.has(key))).toBe(true);
  }
  const search = page.getByRole("textbox", { name: "搜索日志或添加筛选条件" });
  await expect(page.getByText("attributes.order.id：order-demo-123")).toBeVisible();
  await expect(page.getByText(/Trace ID：0123456789abcdef/)).toBeVisible();
  await expect(page.getByText("级别：ERROR")).toBeVisible();
  await expect(page.getByRole("button", { name: "回到最新", exact: true })).toBeDisabled();
  for (const key of ["q", "level", "environment", "from", "to"]) {
    expect(requests.at(-1)?.searchParams.get(key)).toBe(new URL(page.url()).searchParams.get(key));
  }
  await page.getByRole("button", { name: /移除筛选：attributes\.order\.id/ }).click();
  await page.getByRole("button", { name: /移除筛选：Trace ID/ }).click();
  await search.fill("checkout");
  await page.getByRole("button", { name: "查询", exact: true }).click();
  await expect(page.getByText("正文：checkout")).toBeVisible();
  await page.goBack();
  await page.goBack();
  await page.goBack();
  await expect(page.getByText("attributes.order.id：order-demo-123")).toBeVisible();
  await page.reload();
  await expect(page.getByText("attributes.order.id：order-demo-123")).toBeVisible();
  expect(
    requests.every((request) =>
      Object.keys(obsolete).every((key) => !request.searchParams.has(key)),
    ),
  ).toBe(true);
});

test("user search and same-user details preserve scope and reset pagination", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  const requests = await setup(page);
  const input = page.getByRole("textbox", { name: "搜索日志或添加筛选条件" });
  await input.fill('user.id:"customer-123"');
  await page.getByRole("button", { name: "查询", exact: true }).click();
  await expect(page.getByRole("table", { name: "日志列表" }).getByRole("row")).toHaveCount(7);
  await expect.poll(() => requests.at(-1)?.searchParams.get("q")).toBe('user.id:"customer-123"');
  await page.getByRole("button", { name: "移除筛选：用户 ID：customer-123" }).click();
  await expect.poll(() => new URL(page.url()).searchParams.has("q")).toBe(false);
  await page.getByRole("button", { name: "更早日志", exact: true }).click();
  await page.getByRole("button", { name: "older checkout log", exact: true }).click();
  const detail = page.getByRole("dialog", { name: "日志详情" });
  const user = detail.getByRole("region", { name: "用户信息" });
  await expect(user).toContainText("customer-123");
  await expect(user).toContainText("visitor-abc");
  await page.screenshot({ path: "/tmp/openrum-log-user-detail-light.png" });
  await detail.getByRole("button", { name: "同用户日志", exact: true }).click();
  await expect(detail).not.toBeVisible();
  await expect.poll(() => new URL(page.url()).searchParams.has("cursor")).toBe(false);
  await expect(page.getByText("用户 ID：customer-123")).toBeVisible();
  await expect(page.getByRole("table", { name: "日志列表" }).getByRole("row")).toHaveCount(7);
  await page.reload();
  await expect(page.getByText("用户 ID：customer-123")).toBeVisible();
  await expect.poll(() => requests.at(-1)?.searchParams.has("cursor")).toBe(false);
  await page.getByRole("button", { name: "切换至暗色模式", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page
    .getByRole("button", { name: "payment failed: upstream timeout", exact: true })
    .first()
    .click();
  await expect(user).toContainText("customer-123");
  await page.screenshot({ path: "/tmp/openrum-log-user-detail-dark.png" });
  expect(
    requests.every(
      (url) =>
        url.pathname.includes(projectId) &&
        url.searchParams.get("environment") === "production" &&
        url.searchParams.get("from") === from &&
        url.searchParams.get("to") === to,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("anonymous log details show visitor identity and can search it on mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const requests = await setup(page);
  await page.getByRole("button", { name: "checkout started", exact: true }).first().click();
  const detail = page.getByRole("dialog", { name: "日志详情" });
  const user = detail.getByRole("region", { name: "用户信息" });
  await expect(user).toContainText("未设置");
  await expect(user).toContainText("visitor-abc");
  await expect(user.getByRole("button", { name: "同用户日志", exact: true })).toHaveCount(0);
  expect(await detail.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: "/tmp/openrum-log-user-detail-mobile.png" });
  await user.getByRole("button", { name: "同访客日志", exact: true }).click();
  await expect(detail).not.toBeVisible();
  await expect(page.getByText("访客 ID：visitor-abc")).toBeVisible();
  await expect
    .poll(() => requests.at(-1)?.searchParams.get("q"))
    .toBe('anonymous_user_id:"visitor-abc"');
  await expect(page.getByRole("table", { name: "日志列表" }).locator("tbody tr")).toHaveCount(7);
});
