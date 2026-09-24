import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

for (const [width, theme, prefix] of [
  [1280, "light", ""],
  [1280, "dark", "/zh"],
  [390, "light", "/zh"],
  [390, "dark", ""],
] as const) {
  test(`local benchmark evidence stays usable at ${width}px in ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript((value) => localStorage.setItem("openrum-theme", value), theme);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${prefix}/`);
    const architecture = page.locator("#architecture");
    await expect(architecture).toContainText("Apple M4 Pro");
    await expect(architecture).toContainText("24 GiB");
    await expect(architecture).toContainText("7.75 GiB");
    await architecture.locator(`a[href="${prefix}/benchmarks"]`).click();
    await expect(page).toHaveURL(new RegExp(`${prefix}/benchmarks/?$`));
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.locator("#hardware")).toContainText("Apple M4 Pro");
    await expect(page.locator("#limits")).toContainText("2026-09-03");
    await expect(page.locator("a[download]")).toBeVisible();
    const response = await page.request.get("/benchmarks/local-capacity.json");
    expect(response.ok()).toBe(true);
    const evidence = await response.json();
    expect(evidence.productionClaim).toBe(false);
    expect(evidence.acceptedEvents).toBe(evidence.uniqueEventIds);
    await expect(page.locator("#result")).toContainText(evidence.id);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    ).toBeLessThanOrEqual(1);
    expect(errors).toEqual([]);
  });
}

const keyPages = ["/", "/product", "/self-host", "/docs/", "/docs/getting-started/quickstart/"];

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
    await expect(page).toHaveTitle(/OpenRUM|Quickstart/);
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

// The suite above pins itself to the light theme, so a dark-only regression could ship
// unseen: an unlayered `a { color: inherit }` in global.css outranked
// `.ui-button-primary` in `@layer components` and left every anchor-shaped primary
// button inheriting body text, which is 1.12:1 on the lemon-green fill in dark mode.
test("primary buttons stay legible in the dark theme", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("openrum-theme", "dark"));
  await page.goto("/");
  await expect(page.locator("html")).toHaveClass(/dark/);

  // Asserted as "differs from body text" rather than against a literal colour so the
  // test keeps describing the bug if the token's serialised form ever changes.
  const colors = await page
    .locator(".lp-hero a.ui-button-contrast")
    .first()
    .evaluate((node) => ({
      button: getComputedStyle(node).color,
      body: getComputedStyle(document.body).color,
    }));
  expect(colors.button).not.toBe(colors.body);

  const result = await new AxeBuilder({ page }).include(".lp-page").analyze();
  const blocking = result.violations.filter(
    (violation) => violation.impact === "critical" || violation.impact === "serious",
  );
  expect(blocking.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([]);
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
    await expect(page.locator(".lp-rays")).toHaveCount(0);
    await expect(page.locator(".stroke-text[data-ready]")).toHaveCount(2);
    await expect
      .poll(() =>
        page
          .locator(".stroke-text clipPath rect")
          .evaluateAll((nodes) => nodes.every((node) => Number(node.getAttribute("width")) === 1)),
      )
      .toBe(true);
    await expect(page.locator("#lp-hero-title")).toBeVisible();
    await expect(page.locator(".lp-motion-toggle")).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
    await page.locator(".lp-hero").getByRole("link", { name: "立即开始" }).click();
    await expect(page).toHaveURL(/\/zh\/docs\/getting-started\/quickstart\//);
    expect(errors).toEqual([]);
  });
}

test("technology icons use shadcn tooltips with hover, focus and Escape", async ({ page }) => {
  await page.goto("/zh/");
  const stack = page.getByRole("list", { name: "技术栈" });
  const react = stack.getByRole("link", { name: "React", exact: true });
  await react.hover();
  await expect(page.getByRole("tooltip")).toHaveText("React");
  await expect(page.locator('[data-slot="tooltip-content"]')).toBeVisible();
  await expect(page.locator(".lp-tech-label")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await page.mouse.move(0, 0);
  const postgres = stack.getByRole("link", { name: "PostgreSQL", exact: true });
  await postgres.focus();
  await expect(page.getByRole("tooltip")).toHaveText("PostgreSQL");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await expect(postgres).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/zh\/docs\/self-hosting\/postgres\//);
});

test("headline draws strokes before filling without flashing or resizing", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  let release!: () => void;
  const hydrate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(/StrokeText.*\.(?:jsx|js)(?:\?.*)?$/, async (route) => {
    await hydrate;
    await route.continue();
  });
  await page.goto("/zh/", { waitUntil: "commit" });
  const root = page.locator(".stroke-text").first();
  const layout = root.locator(".stroke-text__layout");
  const svg = root.locator("svg");
  const wipe = root.locator("clipPath rect");
  await expect(root).toBeAttached();
  await page.evaluate(() => document.fonts.ready);
  await expect(layout).toHaveCSS("visibility", "hidden");
  await expect(svg).toHaveCSS("visibility", "hidden");
  await expect(wipe).toHaveAttribute("width", "0");
  const before = await root.boundingBox();
  release();
  await expect(root).toHaveAttribute("data-ready", "true");
  const stroke = root.locator("[data-stroke-char]").first();
  const offset = () =>
    stroke.evaluate((node) => parseFloat(getComputedStyle(node).strokeDashoffset));
  const start = await offset();
  expect(start).toBeGreaterThan(0);
  await expect(wipe).toHaveAttribute("width", "0");
  await expect.poll(offset).toBeLessThan(start);
  await expect.poll(offset).toBe(0);
  await expect(wipe).toHaveAttribute("width", "1");
  expect(
    await root
      .locator("[data-stroke-char]")
      .evaluateAll((nodes) =>
        nodes.every((node) => parseFloat(getComputedStyle(node).strokeDashoffset) === 0),
      ),
  ).toBe(true);
  const after = await root.boundingBox();
  expect(after).toEqual(before);
  await expect(layout).toHaveCSS("visibility", "hidden");
  await expect(svg).toBeVisible();
});

test("theme and equivalent language navigation work without a network tracker", async ({
  page,
}) => {
  const foreignRequests = [];
  page.on("request", (request) => {
    if (new URL(request.url()).origin !== "http://127.0.0.1:4322")
      foreignRequests.push(request.url());
  });
  // Seeded to light so the click under test produces dark. Without the seed this
  // asserted the default rather than the toggle, and it started failing the moment
  // the default became dark.
  await page.addInitScript(() => localStorage.setItem("openrum-theme", "light"));
  await page.goto("/product");
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await page.getByRole("button", { name: "Toggle color theme" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.getByRole("link", { name: "切换到简体中文" }).click();
  await expect(page).toHaveURL(/\/zh\/product\/?$/);
  expect(foreignRequests).toEqual([]);
});

test("docs language switch is site-wide and does not mix navigation locales", async ({ page }) => {
  await page.goto("/docs/getting-started/quickstart/");
  const tabs = page.locator(".docs-tabs");
  await expect(tabs.getByRole("link", { name: "Start" })).toBeVisible();
  await expect(tabs.getByRole("link", { name: "开始" })).toHaveCount(0);
  await page.locator("starlight-lang-select select").first().selectOption({ label: "简体中文" });
  await expect(page).toHaveURL(/\/zh\/docs\/getting-started\/quickstart\/?$/);
  await expect(page.locator("h1")).toContainText("开始使用");
  const zhTabs = page.locator(".docs-tabs");
  await expect(zhTabs.getByRole("link", { name: "开始" })).toBeVisible();
  await expect(zhTabs.getByRole("link", { name: "Start" })).toHaveCount(0);
  await expect(page.locator(".docs-sidebar-topic")).toHaveText("开始");
});

test("the sidebar carries one section and the page says where it sits", async ({ page }) => {
  await page.goto("/docs/self-hosting/clickhouse/");
  const sidebar = page.locator("#starlight__sidebar");
  await expect(sidebar.locator(".group-label", { hasText: "Dependency runbooks" })).toBeVisible();
  // A page from a different tab must not be reachable from this sidebar; showing all
  // nine groups at once was what made it unreadable.
  await expect(sidebar.getByRole("link", { name: "Start using OpenRUM" })).toHaveCount(0);
  await expect(page.locator(".docs-tabs a[aria-current]")).toHaveText("Self-hosting");
  await expect(page.locator(".docs-crumbs li")).toHaveText([
    "Docs",
    "Self-hosting",
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
    await page.goto("/docs/getting-started/quickstart/");
    await page.locator(`.sl-markdown-content a[href="/docs/getting-started/${guide}/"]`).click();
    await expect(page).toHaveURL(new RegExp(`/docs/getting-started/${guide}/?$`));
    const sidebar = page.locator("#starlight__sidebar");
    await expect(sidebar.locator('a[aria-current="page"]')).toHaveAttribute(
      "href",
      `/docs/getting-started/${guide}/`,
    );
    const stepCount = guide === "local-development" ? 5 : 3;
    await expect(page.locator(".sl-steps > li")).toHaveCount(stepCount);
    await page.locator("starlight-lang-select select").first().selectOption({ label: "简体中文" });
    await expect(page).toHaveURL(new RegExp(`/zh/docs/getting-started/${guide}/?$`));
    await expect(page.locator(".docs-tabs a[aria-current]")).toHaveText("开始");
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
  await page.locator("starlight-lang-select select").first().selectOption({ label: "简体中文" });
  await expect(page).toHaveURL(/\/zh\/docs\/getting-started\/local-development\/connect-app\/$/);
  await expect(sidebar.locator('a[aria-current="page"]')).toHaveText("接入与验证");
  const production = sidebar
    .locator("details")
    .filter({ has: page.locator("summary", { hasText: "生产部署" }) });
  await production.locator("summary").click();
  await production.getByRole("link", { name: "安装服务", exact: true }).click();
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
      "git clone https://github.com/openrum/openrum.git\ncd openrum\ncorepack enable\npnpm install --frozen-lockfile",
    );
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    ).toBeLessThanOrEqual(1);
    expect(errors).toEqual([]);
  });
}

// The taxonomy moved `operations/` and `security/` under `self-hosting/`. These are the
// URLs that were already published, so they have to keep resolving.
const movedPages = [
  ["/docs/operations/clickhouse/", "/docs/self-hosting/clickhouse/"],
  ["/docs/security/threat-model/", "/docs/self-hosting/security/threat-model/"],
  ["/docs/concepts/domain-model/", "/docs/getting-started/domain-model/"],
  ["/zh/docs/security/privacy/", "/zh/docs/self-hosting/security/privacy/"],
  ["/docs/sdk/frameworks/", "/docs/sdk/browser/"],
  ["/docs/contributing/architecture/", "/docs/self-hosting/architecture/"],
];

for (const [from, to] of movedPages) {
  test(`${from} still reaches its page`, async ({ page }) => {
    await page.goto(from);
    await expect(page).toHaveURL(new RegExp(`${to.replace(/\//g, "\\/")}?$`));
    await expect(page.locator("h1")).toHaveCount(1);
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
  await page.goto("/docs/getting-started/quickstart/");
  await page.getByRole("button", { name: "Copy page" }).click();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain("## Choose your path");
});

test("documentation search is local", async ({ page }) => {
  const foreignRequests = [];
  page.on("request", (request) => {
    if (new URL(request.url()).origin !== "http://127.0.0.1:4322")
      foreignRequests.push(request.url());
  });
  await page.goto("/docs/getting-started/quickstart/");
  const search = page.getByRole("button", { name: /search/i }).first();
  await search.click();
  await page.getByRole("textbox").fill("Source Map");
  expect(foreignRequests).toEqual([]);
});
