import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import starlight from "@astrojs/starlight";
import tailwindcss from "@tailwindcss/vite";

const site = process.env.PUBLIC_SITE_URL || "http://localhost:4321";
const repository = process.env.PUBLIC_REPOSITORY_URL || "https://github.com/openrum/openrum";

/* Code-block syntax palettes.
 *
 * Starlight ships GitHub-flavoured defaults, whose blues, purples and magentas
 * share no hue with anything else on the site — the code blocks read as a widget
 * pasted in from another product. These two themes take their hues straight from
 * the design tokens: lime 125.59 (brand), cyan 185.87 (`--ds-secondary`), amber 72
 * (`--ds-warning`) and red 25.33 (`--ds-danger`), converted to sRGB at lightnesses
 * that clear 4.5:1 on the surface each theme sits on.
 *
 * Literal colours are deliberate and have to live here: a TextMate theme is
 * resolved at build time and cannot read a CSS variable. `design:check` only
 * guards `apps/site/src`, so the boundary it protects is not crossed. Everything
 * that *can* be a token — the frame, border, tab bar, terminal chrome — is one,
 * through `styleOverrides` below, so the block's shell still follows the theme
 * toggle while only the syntax is fixed.
 *
 * Four hues rather than one: colouring every token lime would tie the block to the
 * brand and destroy the thing syntax highlighting is for.
 */
const codeTheme = (type, c) => ({
  name: `openrum-${type}`,
  type,
  colors: { "editor.background": c.bg, "editor.foreground": c.text },
  tokenColors: [
    { scope: ["comment", "punctuation.definition.comment"], settings: { foreground: c.muted } },
    {
      scope: ["keyword", "storage", "storage.type", "keyword.control", "keyword.operator.new"],
      settings: { foreground: c.lime },
    },
    { scope: ["entity.name.tag", "support.type.property-name"], settings: { foreground: c.lime } },
    {
      scope: ["string", "string.quoted", "punctuation.definition.string", "meta.attribute"],
      settings: { foreground: c.cyan },
    },
    {
      scope: ["constant.numeric", "constant.language", "constant.character", "keyword.other.unit"],
      settings: { foreground: c.amber },
    },
    {
      scope: ["entity.name.type", "support.type", "support.class", "entity.name.class"],
      settings: { foreground: c.amber },
    },
    {
      scope: ["entity.name.function", "support.function", "meta.function-call.generic"],
      settings: { foreground: c.text, fontStyle: "bold" },
    },
    { scope: ["entity.other.attribute-name"], settings: { foreground: c.dim } },
    {
      scope: ["variable", "variable.other", "meta.definition.variable", "meta.object-literal.key"],
      settings: { foreground: c.text },
    },
    {
      scope: ["punctuation", "meta.brace", "keyword.operator"],
      settings: { foreground: c.muted },
    },
    { scope: ["invalid", "message.error", "markup.deleted"], settings: { foreground: c.red } },
    { scope: ["markup.inserted"], settings: { foreground: c.lime } },
  ],
});

const codeThemes = [
  codeTheme("dark", {
    bg: "#1a1a1a",
    text: "#e5e5e5",
    muted: "#929292",
    lime: "#b8e954",
    cyan: "#54cec2",
    amber: "#fcb452",
    red: "#f2716a",
    dim: "#b3bba7",
  }),
  codeTheme("light", {
    bg: "#f7f7f7",
    text: "#262626",
    muted: "#636363",
    lime: "#496209",
    cyan: "#006b62",
    amber: "#9f6200",
    red: "#be2229",
    dim: "#465234",
  }),
];

export default defineConfig({
  site,
  output: "static",
  redirects: {
    "/docs/zh": "/zh/docs",
    "/docs/zh/getting-started/quickstart": "/zh/docs/getting-started/quickstart",
    "/docs/zh/getting-started/create-first-project":
      "/zh/docs/getting-started/create-first-project",
    "/docs/zh/sdk/browser": "/zh/docs/sdk/browser",
    "/docs/zh/product/investigation": "/zh/docs/product/investigation",
    "/docs/zh/self-hosting/overview": "/zh/docs/self-hosting/overview",
    "/docs/zh/security/privacy": "/zh/docs/self-hosting/security/privacy",

    // `operations/` and `security/` were top-level URL namespaces left over from the
    // nine-group taxonomy. Keeping them would have left a second classification
    // running alongside the sidebar, free to drift from it.
    "/docs/concepts/domain-model": "/docs/getting-started/domain-model",
    "/docs/operations/capacity": "/docs/self-hosting/capacity",
    "/docs/operations/data-lifecycle": "/docs/self-hosting/data-lifecycle",
    "/docs/operations/troubleshooting": "/docs/self-hosting/troubleshooting",
    "/docs/operations/upgrades": "/docs/self-hosting/upgrades",
    "/docs/operations/backup-restore": "/docs/self-hosting/backup-restore",
    "/docs/operations/postgres": "/docs/self-hosting/postgres",
    "/docs/operations/clickhouse": "/docs/self-hosting/clickhouse",
    "/docs/operations/kafka": "/docs/self-hosting/kafka",
    "/docs/operations/redis": "/docs/self-hosting/redis",
    "/docs/operations/object-storage": "/docs/self-hosting/object-storage",
    "/docs/security/privacy": "/docs/self-hosting/security/privacy",
    "/docs/security/threat-model": "/docs/self-hosting/security/threat-model",
    "/docs/security/vulnerability-reporting": "/docs/self-hosting/security/vulnerability-reporting",
    "/zh/docs/security/privacy": "/zh/docs/self-hosting/security/privacy",

    // Withdrawn from the site and kept in the repository as an internal RFC.
    "/docs/contributing/system-administration": "/docs/self-hosting/overview",

    // Framework setup became tabs on the SDK page, and the two frameworks that need
    // more than a snippet got their own pages.
    "/docs/sdk/frameworks": "/docs/sdk/browser",
    "/zh/docs/sdk/frameworks": "/zh/docs/sdk/browser",

    // The topology is read by whoever is deploying the Instance, not only by
    // contributors, so it sits with the deployment guides.
    "/docs/contributing/architecture": "/docs/self-hosting/architecture",
  },
  integrations: [
    react(),
    starlight({
      title: "OpenRUM",
      description:
        "Open-source, self-hosted frontend monitoring for user behavior and production issues.",
      defaultLocale: "root",
      locales: {
        root: { label: "English", lang: "en" },
        zh: { label: "简体中文", lang: "zh-CN" },
      },
      customCss: ["./src/styles/global.css", "./src/styles/docs.css"],
      expressiveCode: {
        themes: codeThemes,
        // The shell of the block is tokens, so it tracks the theme toggle and sits
        // in the same material as every other panel on the site. Only the syntax
        // colours above are fixed values.
        styleOverrides: {
          borderColor: "var(--ds-border)",
          borderRadius: "var(--radius-lg)",
          codeBackground: "var(--ds-surface)",
          codeFontFamily: "var(--font-mono)",
          scrollbarThumbColor: "var(--ds-border)",
          frames: {
            editorTabBarBackground: "var(--ds-surface-subtle)",
            editorTabBarBorderBottomColor: "var(--ds-border)",
            editorActiveTabBackground: "var(--ds-surface)",
            editorActiveTabBorderColor: "var(--ds-border)",
            editorActiveTabIndicatorTopColor: "var(--ds-primary)",
            editorBackground: "var(--ds-surface)",
            terminalBackground: "var(--ds-surface)",
            terminalTitlebarBackground: "var(--ds-surface-subtle)",
            terminalTitlebarBorderBottomColor: "var(--ds-border)",
          },
        },
      },
      components: {
        Head: "./src/components/DocsHead.astro",
        Footer: "./src/components/DocsFooter.astro",
        Header: "./src/components/docs/DocsHeader.astro",
        Sidebar: "./src/components/docs/DocsSidebar.astro",
        PageTitle: "./src/components/docs/DocsPageTitle.astro",
      },
      // Starlight appends the entry's own path, which already starts at
      // src/content/docs/. Repeating it here produced a 404 on every edit link.
      editLink: { baseUrl: `${repository}/edit/main/apps/site/` },
      social: [{ icon: "github", label: "GitHub", href: repository }],
      // Six top-level groups, rendered by the header as primary navigation and by the
      // sidebar one group at a time. Items are listed in reading order rather than
      // autogenerated, because alphabetical order put Backup and restore ahead of the
      // deployment guide and left readers with no way to tell what comes first.
      sidebar: [
        {
          label: "Get started",
          translations: { zh: "从这里开始", "zh-CN": "从这里开始" },
          items: [
            { slug: "docs/getting-started/quickstart" },
            { slug: "docs/getting-started/create-first-project" },
            { slug: "docs/getting-started/demo-data" },
            { slug: "docs/getting-started/domain-model" },
          ],
        },
        {
          label: "SDK",
          translations: { zh: "SDK", "zh-CN": "SDK" },
          items: [
            { slug: "docs/sdk/browser" },
            { slug: "docs/sdk/nextjs" },
            { slug: "docs/sdk/astro" },
            { slug: "docs/sdk/source-maps" },
          ],
        },
        {
          label: "Product",
          translations: { zh: "产品", "zh-CN": "产品" },
          items: [
            { slug: "docs/product/investigation" },
            { slug: "docs/product/logs" },
            // Analytics is the one capability with a model to learn before you can
            // use it, so it is a group rather than a page. Collapsed by default: a
            // reader who came for Alerts should not have to scroll past five
            // analytics pages to find it.
            {
              label: "Analytics",
              translations: { zh: "行为分析", "zh-CN": "行为分析" },
              collapsed: true,
              items: [
                { slug: "docs/product/analytics" },
                { slug: "docs/product/analytics/custom-events" },
                { slug: "docs/product/analytics/instrumentation" },
                { slug: "docs/product/analytics/explorations" },
                { slug: "docs/product/analytics/ga4" },
              ],
            },
            { slug: "docs/product/performance" },
            { slug: "docs/product/api-monitoring" },
            { slug: "docs/product/alerts" },
            { slug: "docs/product/project-settings" },
            { slug: "docs/product/inbound-filters" },
          ],
        },
        {
          label: "Self-hosting",
          translations: { zh: "自托管", "zh-CN": "自托管" },
          items: [
            {
              label: "Deploy",
              translations: { zh: "部署", "zh-CN": "部署" },
              items: [
                { slug: "docs/self-hosting/overview" },
                { slug: "docs/self-hosting/architecture" },
                { slug: "docs/self-hosting/compose" },
                { slug: "docs/self-hosting/kubernetes" },
                { slug: "docs/self-hosting/dependencies" },
                { slug: "docs/self-hosting/capacity" },
              ],
            },
            {
              label: "Operate",
              translations: { zh: "日常运维", "zh-CN": "日常运维" },
              collapsed: true,
              items: [
                { slug: "docs/self-hosting/upgrades" },
                { slug: "docs/self-hosting/backup-restore" },
                { slug: "docs/self-hosting/data-lifecycle" },
                { slug: "docs/self-hosting/troubleshooting" },
              ],
            },
            // Nobody reads these in order; they are opened when one component
            // misbehaves, which is why they are separated from the guides above.
            {
              label: "Dependency runbooks",
              translations: { zh: "依赖 runbook", "zh-CN": "依赖 runbook" },
              collapsed: true,
              items: [
                { slug: "docs/self-hosting/postgres" },
                { slug: "docs/self-hosting/clickhouse" },
                { slug: "docs/self-hosting/kafka" },
                { slug: "docs/self-hosting/redis" },
                { slug: "docs/self-hosting/object-storage" },
              ],
            },
            {
              label: "Security",
              translations: { zh: "安全", "zh-CN": "安全" },
              collapsed: true,
              items: [
                { slug: "docs/self-hosting/security/privacy" },
                { slug: "docs/self-hosting/security/threat-model" },
                { slug: "docs/self-hosting/security/vulnerability-reporting" },
              ],
            },
          ],
        },
        {
          label: "Reference",
          translations: { zh: "参考", "zh-CN": "参考" },
          items: [
            { slug: "docs/reference/configuration" },
            { slug: "docs/reference/sdk-options" },
            { slug: "docs/reference/event-schema" },
            { slug: "docs/reference/ingest-flags" },
            { slug: "docs/reference/http-api" },
            { slug: "docs/reference/helm-values" },
          ],
        },
        {
          label: "Contributing",
          translations: { zh: "参与贡献", "zh-CN": "参与贡献" },
          items: [
            { slug: "docs/contributing" },
            { slug: "docs/contributing/local-development" },
            { slug: "docs/contributing/roadmap" },
          ],
        },
      ],
    }),
  ],
  vite: { plugins: [tailwindcss()] },
});
