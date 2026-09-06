import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import starlight from "@astrojs/starlight";
import tailwindcss from "@tailwindcss/vite";

const site = process.env.PUBLIC_SITE_URL || "http://localhost:4321";
const repository = process.env.PUBLIC_REPOSITORY_URL || "https://github.com/openrum/openrum";

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
    "/docs/zh/security/privacy": "/zh/docs/security/privacy",
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
      customCss: ["./src/styles/global.css"],
      components: { Footer: "./src/components/DocsFooter.astro" },
      editLink: { baseUrl: `${repository}/edit/main/apps/site/src/content/docs/` },
      social: [{ icon: "github", label: "GitHub", href: repository }],
      sidebar: [
        {
          label: "Start Here",
          translations: { zh: "从这里开始", "zh-CN": "从这里开始" },
          items: [{ autogenerate: { directory: "docs/getting-started" } }],
        },
        {
          label: "Concepts",
          translations: { zh: "概念", "zh-CN": "概念" },
          items: [{ autogenerate: { directory: "docs/concepts" } }],
        },
        {
          label: "SDK Guides",
          translations: { zh: "SDK 指南", "zh-CN": "SDK 指南" },
          items: [{ autogenerate: { directory: "docs/sdk" } }],
        },
        {
          label: "Product",
          translations: { zh: "产品", "zh-CN": "产品" },
          items: [{ autogenerate: { directory: "docs/product" } }],
        },
        {
          label: "Self-hosting",
          translations: { zh: "自托管", "zh-CN": "自托管" },
          items: [{ autogenerate: { directory: "docs/self-hosting" } }],
        },
        {
          label: "Operations",
          translations: { zh: "运维", "zh-CN": "运维" },
          items: [{ autogenerate: { directory: "docs/operations" } }],
        },
        {
          label: "Security & Privacy",
          translations: { zh: "安全与隐私", "zh-CN": "安全与隐私" },
          items: [{ autogenerate: { directory: "docs/security" } }],
        },
        {
          label: "Reference",
          translations: { zh: "参考", "zh-CN": "参考" },
          items: [{ autogenerate: { directory: "docs/reference" } }],
        },
        {
          label: "Contributing",
          translations: { zh: "参与贡献", "zh-CN": "参与贡献" },
          items: [{ autogenerate: { directory: "docs/contributing" } }],
        },
      ],
    }),
  ],
  vite: { plugins: [tailwindcss()] },
});
