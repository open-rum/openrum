import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

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

for (const mode of ["reduced-motion", "no-webgl"] as const) {
  test(`mobile homepage remains usable with ${mode}`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 740 });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    if (mode === "reduced-motion") {
      await page.emulateMedia({ reducedMotion: "reduce" });
    } else {
      await page.addInitScript(() => {
        const original = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (type, ...args) {
          if (type === "webgl") {
            this.dataset.webglAttempted = "true";
            return null;
          }
          return original.call(this, type, ...args);
        } as typeof original;
      });
    }
    await page.goto("/zh/");
    if (mode === "no-webgl") {
      await expect(page.locator(".lp-rays canvas")).toHaveAttribute("data-webgl-attempted", "true");
    } else {
      expect(
        await page
          .locator(".lp-title-ink")
          .first()
          .evaluate((node) => getComputedStyle(node).animationName),
      ).toBe("none");
    }
    await expect(page.locator("h1")).toBeVisible();
    await expect(page.locator(".lp-motion-toggle")).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
    await page.locator(".lp-hero").getByRole("link", { name: "立即开始" }).click();
    await expect(page).toHaveURL(/\/zh\/docs\/getting-started\/quickstart\//);
    expect(errors).toEqual([]);
  });
}

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
  await expect(tabs.getByRole("link", { name: "Get started" })).toBeVisible();
  await expect(tabs.getByRole("link", { name: "从这里开始" })).toHaveCount(0);
  await page.locator("starlight-lang-select select").first().selectOption({ label: "简体中文" });
  await expect(page).toHaveURL(/\/zh\/docs\/getting-started\/quickstart\/?$/);
  await expect(page.locator("h1")).toContainText("五分钟快速开始");
  const zhTabs = page.locator(".docs-tabs");
  await expect(zhTabs.getByRole("link", { name: "从这里开始" })).toBeVisible();
  await expect(zhTabs.getByRole("link", { name: "Get started" })).toHaveCount(0);
  await expect(page.locator(".docs-sidebar-topic")).toHaveText("从这里开始");
});

test("the sidebar carries one section and the page says where it sits", async ({ page }) => {
  await page.goto("/docs/self-hosting/clickhouse/");
  const sidebar = page.locator("#starlight__sidebar");
  await expect(sidebar.locator(".group-label", { hasText: "Dependency runbooks" })).toBeVisible();
  // A page from a different tab must not be reachable from this sidebar; showing all
  // nine groups at once was what made it unreadable.
  await expect(sidebar.getByRole("link", { name: "Five-minute Quickstart" })).toHaveCount(0);
  await expect(page.locator(".docs-tabs a[aria-current]")).toHaveText("Self-hosting");
  await expect(page.locator(".docs-crumbs li")).toHaveText([
    "Docs",
    "Self-hosting",
    "Dependency runbooks",
    "ClickHouse",
  ]);
});

test("the docs index offers the two jobs a reader arrives with", async ({ page }) => {
  await page.goto("/docs/");
  const entry = page.locator(".docs-entry-grid");
  await expect(entry.getByRole("link", { name: /Run an Instance/ })).toBeVisible();
  await expect(entry.getByRole("link", { name: /Instrument an application/ })).toBeVisible();
  // The index sits outside the taxonomy, so it claims no tab and shows no trail.
  await expect(page.locator(".docs-tabs a[aria-current]")).toHaveCount(0);
  await expect(page.locator(".docs-crumbs")).toHaveCount(0);
});

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
  await expect(matrix).toContainText("Planned");
  await expect(matrix).toContainText("CDN");
  await expect(page.getByRole("heading", { name: /drops Events silently/i })).toBeVisible();
});

test("copy page hands over the page's own markdown", async ({ context, page }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/docs/getting-started/quickstart/");
  await page.getByRole("button", { name: "Copy page" }).click();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain("## 1. Start the Instance");
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
