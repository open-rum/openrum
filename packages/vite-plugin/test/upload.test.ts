import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { uploadSourceMaps } from "../src/index.ts";

test("uploads maps through the presigned flow and removes them from the public build", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "openrum-sourcemaps-"));
  await mkdir(join(directory, "assets"));
  const mapPath = join(directory, "assets", "app.js.map");
  await writeFile(
    mapPath,
    JSON.stringify({ version: 3, sources: ["src/app.ts"], mappings: "AAAA" }),
  );
  const requests: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    requests.push(`${init?.method ?? "GET"} ${url}`);
    if (url === "https://oss.example/upload") return new Response(null, { status: 200 });
    if (url.endsWith("/releases")) return Response.json({ id: "release-id" }, { status: 201 });
    if (url.endsWith("/artifacts/presign"))
      return Response.json(
        {
          artifact: { id: "artifact-id" },
          uploadUrl: "https://oss.example/upload",
          method: "PUT",
          headers: {},
        },
        { status: 201 },
      );
    return Response.json({ id: "artifact-id" });
  };
  context.after(() => {
    globalThis.fetch = originalFetch;
  });

  const result = await uploadSourceMaps({
    baseUrl: "https://rum.example",
    projectId: "project",
    release: "web@1",
    outDir: directory,
    sessionCookie: "session",
    csrfToken: "csrf",
  });
  assert.equal(result.uploaded, 1);
  await assert.rejects(readFile(mapPath), { code: "ENOENT" });
  assert.deepEqual(
    requests.map((request) => request.split(" ")[0]),
    ["POST", "POST", "PUT", "POST"],
  );
});

test("removes maps before a failed API call", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "openrum-sourcemaps-"));
  const mapPath = join(directory, "app.js.map");
  await writeFile(mapPath, "map");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ error: { message: "denied" } }, { status: 403 });
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  await assert.rejects(
    uploadSourceMaps({
      baseUrl: "https://rum.example",
      projectId: "project",
      release: "web@1",
      outDir: directory,
      sessionCookie: "session",
      csrfToken: "csrf",
    }),
    /denied/,
  );
  await assert.rejects(readFile(mapPath), { code: "ENOENT" });
});
