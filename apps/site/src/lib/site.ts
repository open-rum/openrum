export type SiteLang = "en" | "zh";

export function docsBase(lang: SiteLang) {
  return lang === "zh" ? "/zh/docs" : "/docs";
}

export function docsPath(lang: SiteLang, slug: string) {
  return `${docsBase(lang)}/${slug.replace(/^\/+/, "")}`;
}

export function equivalentPath(path: string, currentLang: SiteLang) {
  if (currentLang === "zh") return path.replace(/^\/zh/, "") || "/";
  return path === "/" ? "/zh/" : `/zh${path}`;
}
