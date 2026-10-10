// URL and naming helpers shared by the Releases page, project settings and the Issue stack view.

export const OBJECT_STORAGE_SETTINGS_PATH = "/settings/instance/object-storage";

export function uploadTokensPath(projectId: string) {
  return `/projects/${encodeURIComponent(projectId)}/onboarding#upload-tokens`;
}

/** Releases page with a release preselected (or prefilled for registration when missing). */
export function releaseUploadPath(projectId: string, version: string, dist?: string) {
  const parameters = new URLSearchParams({ release: version });
  if (dist) parameters.set("dist", dist);
  return `/projects/${encodeURIComponent(projectId)}/releases?${parameters.toString()}`;
}

/** Reads `?release=&dist=` from a search string. */
export function readReleasePreselection(search: string) {
  const parameters = new URLSearchParams(search);
  const version = parameters.get("release")?.trim();
  if (!version) return undefined;
  return { version, dist: parameters.get("dist")?.trim() ?? "" };
}

/** artifactName the server expects for a script URL: its path without the leading "/", plus ".map". */
export function expectedArtifactName(scriptUrl: string) {
  try {
    const path = new URL(scriptUrl).pathname.replace(/^\/+/, "");
    return path ? `${decodeURIComponent(path)}.map` : undefined;
  } catch {
    return undefined;
  }
}

export function quickStartSnippet(origin: string, projectId: string) {
  return `// vite.config.ts
import { openRUMSourceMaps } from "@openrum/source-map/vite";

export default defineConfig({
  build: { sourcemap: "hidden" },
  plugins: [
    openRUMSourceMaps({
      baseUrl: "${origin}",
      projectId: "${projectId}",
      release: process.env.OPENRUM_RELEASE,
      token: process.env.OPENRUM_UPLOAD_TOKEN,
      // 脚本 URL 的路径前缀，例如 "static/app/"
      urlPrefix: "",
    }),
  ],
});`;
}
