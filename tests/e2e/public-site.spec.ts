import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

for (const [width, prefix] of [
  [1280, ""],
  [390, "/zh"],
] as const) {
  test(`homepage tour, palettes and FAQ work at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${prefix}/`);
    await expect(page.locator("html")).toHaveAttribute("data-palette", "amber");
    const tabs = page.getByRole("tab");
    await expect(tabs).toHaveCount(6);
    await tabs.nth(2).click();
    await expect(tabs.nth(2)).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("tabpanel")).toHaveCount(1);
    await tabs.nth(2).press("ArrowRight");
    await expect(tabs.nth(3)).toBeFocused();
    const faq = page.locator(".lp-faq details");
    await faq.nth(0).locator("summary").click();
    await faq.nth(1).locator("summary").click();
    await expect(faq.nth(1)).toHaveAttribute("open", "");
    await expect(faq.nth(0)).not.toHaveAttribute("open", "");
    await expect(page.locator("#architecture")).toContainText("ClickHouse");
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    ).toBeLessThanOrEqual(1);
    expect(errors).toEqual([]);
  });
}

async function choosePalette(page: Page, menu: string, palette: string) {
  await page.getByRole("banner").getByLabel(menu, { exact: true }).first().click();
  await page.getByRole("menuitemradio", { name: palette }).click();
}

test("docs pages and the logo follow the homepage palette in both themes", async ({ page }) => {
  await page.goto("/");
  await choosePalette(page, "Choose palette", "Magenta");
  await page.goto("/docs/introduction/");
  const html = page.locator("html");
  await expect(html).toHaveAttribute("data-palette", "magenta");
  const logo = () =>
    page
      .locator(".brand-mark svg, header svg[aria-hidden]")
      .first()
      .evaluate((node) => getComputedStyle(node).color);
  const magentaLogo = await logo();
  for (const theme of ["light", "dark"]) {
    await page.evaluate((value) => (document.documentElement.dataset.theme = value), theme);
    expect(await logo()).toBe(magentaLogo);
  }
  await page.goto("/");
  await choosePalette(page, "Choose palette", "Lime");
  await page.goto("/docs/introduction/");
  await expect(html).toHaveAttribute("data-palette", "lime");
  expect(await logo()).not.toBe(magentaLogo);
});

test("homepage palette choice is kept across visits", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/zh/");
  await choosePalette(page, "选择配色", "品红");
  await expect(page.locator("html")).toHaveAttribute("data-palette", "magenta");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-palette", "magenta");
  await page.getByRole("banner").getByLabel("选择配色", { exact: true }).first().click();
  await expect(page.getByRole("menuitemradio", { name: "品红" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
});

const keyPages = ["/", "/zh/", "/docs/", "/docs/introduction/"];

for (const path of keyPages) {
  test(`${path} has metadata, one main heading and no blocking accessibility findings`, async ({
    page,
  }) => {
    // Light is requested explicitly. The site defaults to dark now, so leaving this
    // implicit would silently move the whole suite onto one theme and let a
    // light-only regression ship — which is the mirror of the bug the dark test
    // below was written for.
    await page.addInitScript(() => localStorage.setItem("openrum-theme", "light"));
    await page.goto(path);
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page).toHaveTitle(/OpenRUM|Introduction/);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /.+/);
    await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /.+/);
    await expect(page.locator("[data-openrum-build]")).toContainText(/Release .+ · commit .+/);
    const result = await new AxeBuilder({ page }).analyze();
    // The unreadable current-page colour in the sidebar was a contrast finding, which
    // axe rates "serious"; a threshold of "critical" alone let it ship.
    const blocking = result.violations.filter(
      (violation) => violation.impact === "critical" || violation.impact === "serious",
    );
    expect(blocking.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([]);
  });
}

// The homepage is dark only. Its primary actions must never inherit body text, which
// is how an unlayered `a { color: inherit }` once made them unreadable.
test("homepage primary actions stay legible in every palette", async ({ page }) => {
  await page.goto("/");
  for (const palette of ["amber", "lime", "magenta"]) {
    await page.evaluate((value) => (document.documentElement.dataset.palette = value), palette);
    const colors = await page
      .locator(".lp-hero a.lp-button-primary")
      .first()
      .evaluate((node) => ({
        button: getComputedStyle(node).color,
        body: getComputedStyle(document.body).color,
      }));
    expect(colors.button).not.toBe(colors.body);
    const result = await new AxeBuilder({ page }).include(".lp").analyze();
    const blocking = result.violations.filter(
      (violation) => violation.impact === "critical" || violation.impact === "serious",
    );
    expect(blocking.map((violation) => `${palette} ${violation.id}: ${violation.help}`)).toEqual(
      [],
    );
  }
});

for (const mode of ["reduced-motion", "animated"] as const) {
  test(`mobile homepage remains usable with ${mode}`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 740 });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    if (mode === "reduced-motion") {
      await page.emulateMedia({ reducedMotion: "reduce" });
    }
    await page.goto("/zh/");
    await expect(page.locator("#lp-hero-title")).toBeVisible();
    await expect(page.locator(".lp-shiny")).toHaveText("AI 即将支持");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
    await page.locator(".lp-hero").getByRole("link", { name: "开始部署" }).click();
    await expect(page).toHaveURL(/\/zh\/docs\/self-hosting\/overview\//);
    expect(errors).toEqual([]);
  });
}

test("theme and equivalent language navigation work without a network tracker", async ({
  page,
  baseURL,
}) => {
  const foreignRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).origin !== new URL(baseURL!).origin)
      foreignRequests.push(request.url());
  });
  await page.addInitScript(() => localStorage.setItem("starlight-theme", "light"));
  await page.goto("/docs/product/investigation/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.locator("summary[aria-label='Select theme']").click();
  await page.getByRole("menuitemradio", { name: "Dark", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.locator("summary[aria-label='Select language']").click();
  await page.getByRole("menuitemradio", { name: "简体中文" }).click();
  await expect(page).toHaveURL(/\/zh\/docs\/product\/investigation\/?$/);
  expect(foreignRequests).toEqual([]);
});

test("docs language switch is site-wide and does not mix navigation locales", async ({ page }) => {
  await page.goto("/docs/introduction/");
  const tabs = page.locator(".docs-tabs");
  await expect(tabs.getByRole("link", { name: "Get started" })).toBeVisible();
  await expect(tabs.getByRole("link", { name: "快速开始" })).toHaveCount(0);
  await page.locator("summary[aria-label='Select language']").click();
  await page.getByRole("menuitemradio", { name: "简体中文" }).click();
  await expect(page).toHaveURL(/\/zh\/docs\/introduction\/?$/);
  await expect(page.locator("h1")).toContainText("介绍");
  const zhTabs = page.locator(".docs-tabs");
  await expect(zhTabs.getByRole("link", { name: "快速开始" })).toBeVisible();
  await expect(zhTabs.getByRole("link", { name: "Get started" })).toHaveCount(0);
  await expect(
    page.locator("#starlight__sidebar").getByText("认证配置", { exact: true }),
  ).toBeAttached();
});

test("authentication guide works in both languages and a narrow dark viewport", async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => localStorage.setItem("starlight-theme", "dark"));
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/docs/self-hosting/authentication/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("h1")).toHaveText("Console authentication");
  await expect(page.locator(".sl-steps > li")).toHaveCount(4);
  await expect(page.locator("#starlight__sidebar a[aria-current='page']")).toHaveAttribute(
    "href",
    "/docs/self-hosting/authentication/",
  );
  await page.locator(".expressive-code").first().getByRole("button").click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    "https://rum.example.com/api/v1/auth/providers/<provider-id>/callback",
  );
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
  ).toBeLessThanOrEqual(1);
  await page.locator("summary[aria-label='Select language']").click();
  await page.getByRole("menuitemradio", { name: "简体中文" }).click();
  await expect(page).toHaveURL(/\/zh\/docs\/self-hosting\/authentication\/?$/);
  await expect(page.locator("h1")).toHaveText("控制台认证");
  await expect(page.locator(".sl-steps > li")).toHaveCount(4);
  await expect(page.locator("#starlight__sidebar a[aria-current='page']")).toHaveAttribute(
    "href",
    "/zh/docs/self-hosting/authentication/",
  );
});

test("the sidebar carries one section and the page says where it sits", async ({ page }) => {
  await page.goto("/docs/self-hosting/clickhouse/");
  const sidebar = page.locator("#starlight__sidebar");
  // The group holding the current page opens itself, so the reader can see where they are.
  await expect(sidebar.locator(".group-label", { hasText: "Dependency runbooks" })).toBeVisible();
  await expect(sidebar.locator('a[aria-current="page"]')).toHaveText("ClickHouse");
  // A page from a different tab must not be reachable from this sidebar.
  await expect(sidebar.getByRole("link", { name: "Browser SDK" })).toHaveCount(0);
  await expect(page.locator(".docs-tabs a[aria-current]")).toHaveText("Get started");
  await expect(page.locator(".docs-crumbs li")).toHaveText([
    "Docs",
    "Get started",
    "Operate",
    "Dependency runbooks",
    "ClickHouse",
  ]);
});

test("the docs index offers local development and production deployment", async ({ page }) => {
  await page.goto("/docs/");
  const entry = page.locator(".docs-entry-grid");
  await expect(entry.getByRole("link", { name: /Local development/ })).toBeVisible();
  await expect(entry.getByRole("link", { name: /Production deployment/ })).toBeVisible();
  // The index sits outside the taxonomy, so it claims no tab and shows no trail.
  await expect(page.locator(".docs-tabs a[aria-current]")).toHaveCount(0);
  await expect(page.locator(".docs-crumbs")).toHaveCount(0);
});

for (const guide of ["local-development", "production-deployment"]) {
  test(`start guides preserve ${guide} across navigation and language changes`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/docs/introduction/");
    await page.locator(`.sl-markdown-content a[href="/docs/getting-started/${guide}/"]`).click();
    await expect(page).toHaveURL(new RegExp(`/docs/getting-started/${guide}/?$`));
    const sidebar = page.locator("#starlight__sidebar");
    await expect(sidebar.locator('a[aria-current="page"]')).toHaveAttribute(
      "href",
      `/docs/getting-started/${guide}/`,
    );
    const stepCount = guide === "local-development" ? 5 : 3;
    await expect(page.locator(".sl-steps > li")).toHaveCount(stepCount);
    await page.locator("summary[aria-label='Select language']").click();
    await page.getByRole("menuitemradio", { name: "简体中文" }).click();
    await expect(page).toHaveURL(new RegExp(`/zh/docs/getting-started/${guide}/?$`));
    await expect(page.locator(".docs-tabs a[aria-current]")).toHaveText("快速开始");
    await expect(page.locator(".sl-steps > li")).toHaveCount(stepCount);
    await sidebar.getByRole("link", { name: "创建第一个项目", exact: true }).click();
    await expect(page).toHaveURL(/\/zh\/docs\/getting-started\/create-first-project\/?$/);
    await expect(page.locator("h1")).toHaveText("创建第一个项目");
    expect(errors).toEqual([]);
  });
}

test("start sidebar groups collapse and preserve child pages across languages", async ({
  page,
}) => {
  await page.goto("/docs/getting-started/local-development/");
  const sidebar = page.locator("#starlight__sidebar");
  const local = sidebar
    .locator("details")
    .filter({ has: page.locator("summary", { hasText: "Local development" }) });
  await expect(local).toHaveAttribute("open", "");
  await local.locator("summary").click();
  await expect(local).not.toHaveAttribute("open");
  await expect(local.getByRole("link", { name: "Connect and verify", exact: true })).toBeHidden();
  await local.locator("summary").click();
  await local.getByRole("link", { name: "Connect and verify", exact: true }).click();
  await expect(page).toHaveURL(/\/docs\/getting-started\/local-development\/connect-app\/$/);
  await page.locator("summary[aria-label='Select language']").click();
  await page.getByRole("menuitemradio", { name: "简体中文" }).click();
  await expect(page).toHaveURL(/\/zh\/docs\/getting-started\/local-development\/connect-app\/$/);
  await expect(sidebar.locator('a[aria-current="page"]')).toHaveText("接入与验证");
  await sidebar
    .locator("summary")
    .filter({ hasText: /^部署$/ })
    .click();
  await sidebar.getByRole("link", { name: "安装服务", exact: true }).click();
  await expect(page).toHaveURL(/\/zh\/docs\/getting-started\/production-deployment\/install\/$/);
  await expect(
    page.locator(".expressive-code .header").filter({ hasText: "runtime-secret.yaml" }),
  ).toBeVisible();
  await expect(
    page.locator(".expressive-code .header").filter({ hasText: "values.production.yaml" }),
  ).toBeVisible();
  await page
    .locator(
      '.sl-markdown-content a[href="/zh/docs/getting-started/production-deployment/first-run/"]',
    )
    .click();
  await expect(page.locator("h1")).toHaveText("首次使用与维护");
});

test("Operate holds the sign-in guides in both languages", async ({ page }) => {
  await page.goto("/docs/introduction/");
  const sidebar = page.locator("#starlight__sidebar");
  await sidebar
    .locator("summary")
    .filter({ hasText: /^Operate$/ })
    .click();
  await sidebar
    .locator("summary")
    .filter({ hasText: /^Authentication setup$/ })
    .click();
  await sidebar.getByRole("link", { name: "Sign in with LDAP" }).click();
  await expect(page).toHaveURL(/\/docs\/getting-started\/sign-in\/ldap\/$/);
  await expect(page.locator("h1")).toHaveText("Sign in with LDAP");

  await page.locator("summary[aria-label='Select language']").click();
  await page.getByRole("menuitemradio", { name: "简体中文" }).click();
  await expect(page).toHaveURL(/\/zh\/docs\/getting-started\/sign-in\/ldap\/$/);
  await expect(page.locator("h1")).toHaveText("使用 LDAP 登录");
  await expect(sidebar.locator("summary").filter({ hasText: /^认证配置$/ })).toBeVisible();
});

for (const [width, theme, prefix] of [
  [1338, "light", ""],
  [390, "dark", "/zh"],
] as const) {
  test(`native documentation steps and code copy work at ${width}px in ${theme}`, async ({
    page,
    context,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript((value) => localStorage.setItem("starlight-theme", value), theme);
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${prefix}/docs/getting-started/local-development/`);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expect(page.locator(".sl-steps > li")).toHaveCount(5);
    const block = page.locator(".expressive-code").first();
    await block.scrollIntoViewIfNeeded();
    await expect(block.locator(".frame.is-terminal > .header")).toBeVisible();
    expect((await block.locator(".header").boundingBox())!.height).toBeGreaterThan(20);
    await block.getByRole("button").click();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toBe(
      "git clone https://github.com/open-rum/openrum.git\ncd openrum\ncorepack enable\npnpm install --frozen-lockfile",
    );
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    ).toBeLessThanOrEqual(1);
    expect(errors).toEqual([]);
  });
}

// `a { color: inherit }` in global.css is unlayered and silently outranked Starlight's
// link colour, leaving prose links the exact colour of body text.
test("prose links are told apart from body text by more than one signal", async ({ page }) => {
  await page.goto("/docs/sdk/browser/");
  const link = page
    .locator('.sl-markdown-content a[href="/docs/getting-started/create-first-project/"]')
    .first();
  const style = await link.evaluate((node) => {
    const own = getComputedStyle(node);
    return {
      color: own.color,
      decoration: own.textDecorationLine,
      body: getComputedStyle(document.body).color,
    };
  });
  expect(style.decoration).toContain("underline");
  expect(style.color).not.toBe(style.body);
});

// Starlight does not wrap tables in a scroll container, so a wide one used to be clipped
// at the prose column with no way to reach the cells beyond it.
test("a wide reference table keeps every cell reachable", async ({ page }) => {
  await page.goto("/docs/reference/sdk-options/");
  const overflow = await page
    .locator(".sl-markdown-content table")
    .first()
    .evaluate((table) => ({
      hidden: table.scrollWidth - table.clientWidth,
      overflowX: getComputedStyle(table).overflowX,
    }));
  expect(overflow.overflowX).toBe("auto");
  expect(overflow.hidden).toBeLessThanOrEqual(0);
});

// The diagram is rendered to SVG before the build precisely so that it costs no script.
test("the architecture diagram is inline SVG that follows the theme", async ({ page }) => {
  await page.goto("/docs/self-hosting/architecture/");
  const diagram = page.locator(".docs-diagram svg");
  await expect(diagram).toBeVisible();
  await expect(page.locator(".docs-diagram")).toContainText("event-path.mmd");
  expect(await page.locator(".docs-diagram script").count()).toBe(0);

  const stroke = await diagram.evaluate(
    (svg) => getComputedStyle(svg.querySelector(".flowchart-link")).stroke,
  );
  expect(stroke).not.toBe("");
  expect(stroke).not.toContain("var(");
});

test("the SDK page states its limitations rather than implying support", async ({ page }) => {
  await page.goto("/docs/sdk/browser/");
  // Starlight wraps headings, so the matrix is found by its content rather than by
  // position relative to the heading.
  const matrix = page.locator(".sl-markdown-content table", { hasText: "Not supported" });
  await expect(matrix).toContainText("Works");
  await expect(matrix).toContainText("CDN");
  await expect(page.getByRole("heading", { name: /drops Events silently/i })).toBeVisible();
});

test("copy page hands over the page's own markdown", async ({ context, page }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/docs/introduction/");
  await page.getByRole("button", { name: "Copy page" }).click();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain("## Where to start");
});

test("documentation search is local", async ({ page, baseURL }) => {
  const foreignRequests = [];
  page.on("request", (request) => {
    if (new URL(request.url()).origin !== new URL(baseURL!).origin)
      foreignRequests.push(request.url());
  });
  await page.goto("/docs/introduction/");
  const search = page.getByRole("button", { name: /search/i }).first();
  await search.click();
  await page.getByRole("textbox").fill("Source Map");
  await expect(page.locator(".pagefind-ui__result").first()).toBeVisible();
  expect(foreignRequests).toEqual([]);
});
