import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import {
  normalizeUrlPrefix,
  OpenRUMUploadError,
  removeSourceMappingComments,
  uploadSourceMaps,
  type OpenRUMSourceMapOptions,
} from "../src/index.ts";

type Call = { method: string; url: string; headers: Headers; body: string };
type Handler = (call: Call) => Response | Promise<Response>;

function mockFetch(context: TestContext, handler: Handler): Call[] {
  const calls: Call[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const call: Call = {
      method: init?.method ?? "GET",
      url: String(input),
      headers: new Headers(init?.headers),
      body: typeof init?.body === "string" ? init.body : "",
    };
    calls.push(call);
    return handler(call);
  };
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  return calls;
}

function grant(id = "artifact-id") {
  return Response.json(
    {
      artifact: { id },
      uploadUrl: `https://oss.example/upload/${id}`,
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      skipped: false,
    },
    { status: 201 },
  );
}

function apiError(status: number, code: string, message = code) {
  return Response.json({ error: { code, message, requestId: "req-1" } }, { status });
}

/** Default happy-path server; `override` may answer a call first. */
function server(override?: (call: Call) => Response | undefined): Handler {
  return (call) => {
    const answer = override?.(call);
    if (answer) return answer;
    if (call.url.startsWith("https://oss.example/")) return new Response(null, { status: 200 });
    if (call.url.endsWith("/releases")) return Response.json({ id: "release-id" }, { status: 201 });
    if (call.url.endsWith("/artifacts/presign")) return grant();
    return Response.json({ id: "artifact-id", status: "ready" });
  };
}

async function buildDirectory(files: Record<string, string>) {
  const directory = await mkdtemp(join(tmpdir(), "openrum-sourcemaps-"));
  for (const [name, contents] of Object.entries(files)) {
    const path = join(directory, name);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, contents);
  }
  return directory;
}

const map = JSON.stringify({ version: 3, sources: ["src/app.ts"], mappings: "AAAA" });

function silentLogger() {
  const lines: string[] = [];
  return {
    lines,
    logger: { info: (line: string) => lines.push(line), warn: (line: string) => lines.push(line) },
  };
}

function options(outDir: string, extra: Partial<OpenRUMSourceMapOptions> = {}) {
  return {
    baseUrl: "https://rum.example/",
    projectId: "project",
    release: "web@1",
    outDir,
    token: "orut_test",
    retryDelayMs: 1,
    logger: silentLogger().logger,
    ...extra,
  } satisfies OpenRUMSourceMapOptions;
}

test("uploads maps with a bearer token and removes them from the public build", async (context) => {
  const directory = await buildDirectory({ "assets/app.js.map": map, "assets/app.js": "x" });
  const calls = mockFetch(context, server());

  const result = await uploadSourceMaps(options(directory));

  assert.equal(result.uploaded, 1);
  assert.equal(result.releaseId, "release-id");
  await assert.rejects(readFile(join(directory, "assets/app.js.map")), { code: "ENOENT" });
  assert.deepEqual(
    calls.map((call) => `${call.method} ${call.url}`),
    [
      "POST https://rum.example/api/v1/projects/project/releases",
      "POST https://rum.example/api/v1/projects/project/releases/release-id/artifacts/presign",
      "PUT https://oss.example/upload/artifact-id",
      "POST https://rum.example/api/v1/projects/project/releases/release-id/artifacts/artifact-id/complete",
    ],
  );
  const apiCalls = calls.filter((call) => call.url.startsWith("https://rum.example/"));
  for (const call of apiCalls) {
    assert.equal(call.headers.get("authorization"), "Bearer orut_test");
    assert.equal(call.headers.get("cookie"), null);
    assert.equal(call.headers.get("x-csrf-token"), null);
  }
  const upload = calls.find((call) => call.method === "PUT")!;
  assert.equal(upload.headers.get("authorization"), null, "token must not reach object storage");
  assert.equal(JSON.parse(calls[1]!.body).artifactName, "assets/app.js.map");
});

test("falls back to the deprecated session cookie and CSRF token", async (context) => {
  const directory = await buildDirectory({ "app.js.map": map });
  const calls = mockFetch(context, server());
  const { lines, logger } = silentLogger();
  const previous = process.env.OPENRUM_UPLOAD_TOKEN;
  delete process.env.OPENRUM_UPLOAD_TOKEN;
  context.after(() => {
    if (previous !== undefined) process.env.OPENRUM_UPLOAD_TOKEN = previous;
  });

  await uploadSourceMaps(
    options(directory, { token: undefined, sessionCookie: "s", csrfToken: "c", logger }),
  );

  assert.equal(calls[0]!.headers.get("x-csrf-token"), "c");
  assert.match(calls[0]!.headers.get("cookie") ?? "", /openrum_session=s/);
  assert.equal(calls[0]!.headers.get("authorization"), null);
  assert.ok(lines.some((line) => /deprecated/.test(line)));
});

test("requires a token or a session with a clear error", async () => {
  const previous = process.env.OPENRUM_UPLOAD_TOKEN;
  delete process.env.OPENRUM_UPLOAD_TOKEN;
  try {
    await assert.rejects(
      uploadSourceMaps(options("dist", { token: undefined })),
      /requires an upload token.*OPENRUM_UPLOAD_TOKEN/,
    );
  } finally {
    if (previous !== undefined) process.env.OPENRUM_UPLOAD_TOKEN = previous;
  }
});

test("joins the URL prefix before the build-relative path", async (context) => {
  const directory = await buildDirectory({ "assets/index-abc.js.map": map });
  const calls = mockFetch(context, server());

  await uploadSourceMaps(options(directory, { urlPrefix: "/static//app" }));

  const presign = calls.find((call) => call.url.endsWith("/presign"))!;
  assert.equal(JSON.parse(presign.body).artifactName, "static/app/assets/index-abc.js.map");
  assert.equal(normalizeUrlPrefix(undefined), "");
  assert.equal(normalizeUrlPrefix("/"), "");
  assert.equal(normalizeUrlPrefix("./static\\app/"), "static/app/");
  assert.equal(normalizeUrlPrefix("https://cdn.example.com/static/app/?v=1"), "static/app/");
});

test("skips maps the server already stores with the same checksum", async (context) => {
  const directory = await buildDirectory({ "a.js.map": map, "b.js.map": map });
  const calls = mockFetch(
    context,
    server((call) =>
      call.url.endsWith("/presign") && JSON.parse(call.body).artifactName === "a.js.map"
        ? Response.json({ artifact: { id: "a" }, skipped: true })
        : undefined,
    ),
  );

  const result = await uploadSourceMaps(options(directory));

  assert.equal(result.skipped, 1);
  assert.equal(result.uploaded, 1);
  assert.equal(calls.filter((call) => call.method === "PUT").length, 1);
  assert.equal(calls.filter((call) => call.url.endsWith("/complete")).length, 1);
});

test("retries a transient 503 and then succeeds", async (context) => {
  const directory = await buildDirectory({ "app.js.map": map });
  let presigns = 0;
  mockFetch(
    context,
    server((call) => {
      if (!call.url.endsWith("/presign")) return undefined;
      presigns += 1;
      return presigns === 1 ? apiError(503, "OBJECT_STORAGE_UNAVAILABLE") : undefined;
    }),
  );

  const result = await uploadSourceMaps(options(directory));

  assert.equal(presigns, 2);
  assert.equal(result.uploaded, 1);
});

test("retries network errors at most twice", async (context) => {
  const directory = await buildDirectory({ "app.js.map": map });
  let uploads = 0;
  mockFetch(
    context,
    server((call) => {
      if (call.method !== "PUT") return undefined;
      uploads += 1;
      throw new TypeError("fetch failed");
    }),
  );

  await assert.rejects(uploadSourceMaps(options(directory)), OpenRUMUploadError);
  assert.equal(uploads, 3);
});

test("does not retry a 400 validation error and reports the failure", async (context) => {
  const directory = await buildDirectory({ "app.js.map": map });
  let presigns = 0;
  mockFetch(
    context,
    server((call) => {
      if (!call.url.endsWith("/presign")) return undefined;
      presigns += 1;
      return apiError(400, "VALIDATION_ERROR", "artifactName is invalid");
    }),
  );
  const { lines, logger } = silentLogger();

  const error = await uploadSourceMaps(options(directory, { logger })).catch((e: unknown) => e);

  assert.ok(error instanceof OpenRUMUploadError);
  assert.equal(presigns, 1);
  assert.equal(error.result.failed, 1);
  assert.match(error.message, /failed for 1 of 1 file/);
  assert.ok(lines.some((line) => /0 uploaded, 0 skipped \(unchanged\), 1 failed/.test(line)));
  assert.ok(lines.some((line) => /app\.js\.map: artifactName is invalid/.test(line)));
});

test("fails a changed map with ARTIFACT_EXISTS unless replace is set", async (context) => {
  const directory = await buildDirectory({ "app.js.map": map, "vendor.js.map": map });
  const bodies: Record<string, unknown>[] = [];
  mockFetch(
    context,
    server((call) => {
      if (!call.url.endsWith("/presign")) return undefined;
      const body = JSON.parse(call.body) as Record<string, unknown>;
      bodies.push(body);
      if (body.artifactName === "app.js.map" && body.replace !== true)
        return apiError(409, "ARTIFACT_EXISTS", "artifact already exists");
      return undefined;
    }),
  );

  const error = await uploadSourceMaps(options(directory)).catch((e: unknown) => e);
  assert.ok(error instanceof OpenRUMUploadError);
  assert.equal(error.result.uploaded, 1);
  assert.equal(error.result.failed, 1);
  const failure = error.result.files.find((file) => file.status === "failed")!;
  assert.equal(failure.artifactName, "app.js.map");
  assert.match(failure.error ?? "", /replace: true/);

  const replaced = await buildDirectory({ "app.js.map": map });
  bodies.length = 0;
  const result = await uploadSourceMaps(options(replaced, { replace: true }));
  assert.equal(result.uploaded, 1);
  assert.equal(bodies[0]!.replace, true);
});

test("stops after a fatal storage error instead of repeating it for every map", async (context) => {
  const directory = await buildDirectory({ "a.js.map": map, "b.js.map": map, "c.js.map": map });
  let presigns = 0;
  mockFetch(
    context,
    server((call) => {
      if (!call.url.endsWith("/presign")) return undefined;
      presigns += 1;
      return apiError(503, "OBJECT_STORAGE_NOT_CONFIGURED", "object storage is not configured");
    }),
  );

  const error = await uploadSourceMaps(options(directory, { concurrency: 1 })).catch(
    (e: unknown) => e,
  );
  assert.ok(error instanceof OpenRUMUploadError);
  assert.equal(presigns, 1);
  assert.equal(error.result.failed, 3);
});

test("strips sourceMappingURL comments from emitted scripts and styles", async (context) => {
  const directory = await buildDirectory({
    "assets/app.js": "console.log(1);\n//# sourceMappingURL=app.js.map\n",
    "assets/app.js.map": map,
    "assets/worker.mjs": "export {};\n//# sourceMappingURL=worker.mjs.map",
    "assets/app.css": "a{color:red}\n/*# sourceMappingURL=app.css.map */\n",
    "assets/keep.txt": "//# sourceMappingURL=untouched\n",
  });
  mockFetch(context, server());

  await uploadSourceMaps(options(directory));

  assert.equal(await readFile(join(directory, "assets/app.js"), "utf8"), "console.log(1);\n");
  assert.equal(await readFile(join(directory, "assets/worker.mjs"), "utf8"), "export {};\n");
  assert.equal(await readFile(join(directory, "assets/app.css"), "utf8"), "a{color:red}\n");
  assert.equal(
    await readFile(join(directory, "assets/keep.txt"), "utf8"),
    "//# sourceMappingURL=untouched\n",
  );
  assert.equal(
    removeSourceMappingComments('const s = "//# sourceMappingURL=x";\n'),
    'const s = "//# sourceMappingURL=x";\n',
  );
});

test("rejects maps larger than 64 MiB before contacting the server", async (context) => {
  const directory = await buildDirectory({ "small.js.map": map });
  await writeFile(join(directory, "huge.js.map"), Buffer.alloc(64 * 1024 * 1024 + 1));
  const calls = mockFetch(context, server());

  const error = await uploadSourceMaps(options(directory)).catch((e: unknown) => e);

  assert.ok(error instanceof OpenRUMUploadError);
  const huge = error.result.files.find((file) => file.artifactName === "huge.js.map")!;
  assert.equal(huge.status, "failed");
  assert.match(huge.error ?? "", /64 MiB/);
  assert.equal(error.result.uploaded, 1);
  assert.equal(
    calls.filter((call) => call.url.endsWith("/presign")).length,
    1,
    "the oversized map is never presigned",
  );
  await assert.rejects(readFile(join(directory, "huge.js.map")), { code: "ENOENT" });
});

test("removes maps before a failed API call", async (context) => {
  const directory = await buildDirectory({ "app.js.map": "map" });
  mockFetch(context, () => apiError(401, "INVALID_UPLOAD_TOKEN", "invalid upload token"));

  await assert.rejects(uploadSourceMaps(options(directory)), /invalid upload token/);
  await assert.rejects(readFile(join(directory, "app.js.map")), { code: "ENOENT" });
});
