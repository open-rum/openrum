// Public documentation lives on the marketing site. Deployments that host their own
// copy can point the Console at it with VITE_DOCS_URL.
const docsBase =
  (import.meta.env.VITE_DOCS_URL as string | undefined) ?? "https://openrum.dev/docs";

export function docsUrl(slug: string, language: "zh" | "en" = "zh") {
  const base = docsBase.replace(/\/+$/, "");
  const localized = language === "zh" ? base.replace(/\/docs$/, "/zh/docs") : base;
  return `${localized}/${slug.replace(/^\/+/, "")}`;
}
