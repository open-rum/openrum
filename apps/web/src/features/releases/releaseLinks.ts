// URL and naming helpers shared by the Source Map page, project settings and the Issue stack view.

export const OBJECT_STORAGE_SETTINGS_PATH = "/settings/instance/object-storage";

export function sourceMapSettingsPath(projectId: string) {
  return `/settings/project/${encodeURIComponent(projectId)}/sourcemaps`;
}

/** Where upload tokens are managed: the Source Map page, since they only upload Source Maps. */
export function uploadTokensPath(projectId: string) {
  return `${sourceMapSettingsPath(projectId)}#upload-tokens`;
}

/** Source Map page with a release preselected (or prefilled for registration when missing). */
export function releaseUploadPath(projectId: string, version: string, dist?: string) {
  const parameters = new URLSearchParams({ release: version });
  if (dist) parameters.set("dist", dist);
  return `${sourceMapSettingsPath(projectId)}?${parameters.toString()}`;
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
import { openRUMSourceMaps } from "@openrum/sourcemap/vite";

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
