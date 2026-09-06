import { createHash } from "node:crypto";
import { readdir, readFile, rm } from "node:fs/promises";
import { resolve, relative, sep } from "node:path";
import type { Plugin } from "vite";

export type OpenRUMSourceMapOptions = {
  baseUrl: string;
  projectId: string;
  release: string;
  dist?: string;
  commitSha?: string;
  outDir?: string;
  sessionCookie: string;
  csrfToken: string;
};

type Release = { id: string };
type Artifact = { id: string };
type Presign = {
  artifact: Artifact;
  uploadUrl: string;
  method: string;
  headers: Record<string, string>;
};

export function openRUMSourceMaps(options: OpenRUMSourceMapOptions): Plugin {
  validateOptions(options);
  return {
    name: "openrum-sourcemaps",
    apply: "build",
    enforce: "post",
    async closeBundle() {
      await uploadSourceMaps(options);
    },
  };
}

export async function uploadSourceMaps(options: OpenRUMSourceMapOptions) {
  validateOptions(options);
  const output = resolve(options.outDir ?? "dist");
  const paths = await findSourceMaps(output);
  if (!paths.length) return { releaseId: undefined, uploaded: 0 };
  const maps = await Promise.all(
    paths.map(async (path) => ({
      path,
      artifactName: relative(output, path).split(sep).join("/"),
      contents: await readFile(path),
    })),
  );

  // Remove maps before any network request so an upload failure can never leave
  // a public build directory containing source code.
  await Promise.all(paths.map((path) => rm(path, { force: true })));

  const release = await api<Release>(
    options,
    `/api/v1/projects/${encodeURIComponent(options.projectId)}/releases`,
    {
      method: "POST",
      body: JSON.stringify({
        version: options.release,
        dist: options.dist ?? "",
        commitSha: options.commitSha ?? "",
        deployedAt: new Date().toISOString(),
      }),
    },
  );
  for (const map of maps) {
    const sha256 = createHash("sha256").update(map.contents).digest("hex");
    const grant = await api<Presign>(
      options,
      `/api/v1/projects/${encodeURIComponent(options.projectId)}/releases/${encodeURIComponent(release.id)}/artifacts/presign`,
      {
        method: "POST",
        body: JSON.stringify({
          artifactName: map.artifactName,
          sha256,
          sizeBytes: map.contents.byteLength,
        }),
      },
    );
    const upload = await fetch(grant.uploadUrl, {
      method: grant.method,
      headers: grant.headers,
      body: map.contents,
    });
    if (!upload.ok)
      throw new Error(
        `OpenRUM Source Map upload failed (${upload.status}) for ${map.artifactName}`,
      );
    await api(
      options,
      `/api/v1/projects/${encodeURIComponent(options.projectId)}/releases/${encodeURIComponent(release.id)}/artifacts/${encodeURIComponent(grant.artifact.id)}/complete`,
      { method: "POST" },
    );
  }
  return { releaseId: release.id, uploaded: maps.length };
}

async function findSourceMaps(directory: string): Promise<string[]> {
  const output: string[] = [];
  async function visit(current: string) {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      const path = resolve(current, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && entry.name.endsWith(".map")) output.push(path);
    }
  }
  await visit(directory);
  return output.sort();
}

async function api<T = unknown>(
  options: OpenRUMSourceMapOptions,
  path: string,
  init: RequestInit,
): Promise<T> {
  const response = await fetch(`${options.baseUrl.replace(/\/$/, "")}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Cookie: `openrum_session=${options.sessionCookie}; openrum_csrf=${options.csrfToken}`,
      "X-CSRF-Token": options.csrfToken,
      ...init.headers,
    },
  });
  const payload = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
  if (!response.ok)
    throw new Error(payload.error?.message ?? `OpenRUM API request failed (${response.status})`);
  return payload as T;
}

function validateOptions(options: OpenRUMSourceMapOptions) {
  if (
    !/^https?:\/\//.test(options.baseUrl) ||
    !options.projectId ||
    !options.release ||
    !options.sessionCookie ||
    !options.csrfToken
  ) {
    throw new Error(
      "OpenRUM Source Map options require baseUrl, projectId, release, sessionCookie, and csrfToken",
    );
  }
}

export default openRUMSourceMaps;
