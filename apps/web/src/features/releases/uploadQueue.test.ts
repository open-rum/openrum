import { describe, expect, it, vi } from "vitest";
import { HTTPError } from "@/lib/auth/session";
import { MAX_ARTIFACT_BYTES, ObjectUploadError, type Artifact } from "@/lib/api/releases";
import {
  artifactNameFor,
  describeUploadError,
  normalizeUrlPrefix,
  planUploads,
  runWithConcurrency,
  selectedFilesFrom,
  summarizeUploads,
  uploadOne,
  type UploadDeps,
  type UploadItem,
} from "./uploadQueue";

function mapFile(name: string, options: { size?: number; folderPath?: string } = {}) {
  const file = new File(["{}"], name, { type: "application/json" });
  if (options.size !== undefined) Object.defineProperty(file, "size", { value: options.size });
  if (options.folderPath !== undefined)
    Object.defineProperty(file, "webkitRelativePath", { value: options.folderPath });
  return file;
}

function artifact(overrides: Partial<Artifact> = {}): Artifact {
  return {
    id: "artifact-1",
    releaseId: "release-1",
    artifactName: "assets/app.js.map",
    sizeBytes: 2,
    status: "ready",
    createdAt: "2026-09-30T00:00:00Z",
    updatedAt: "2026-09-30T00:00:00Z",
    ...overrides,
  };
}

function grant() {
  return {
    artifact: artifact({ status: "pending" }),
    uploadUrl: "https://oss.example/upload",
    method: "PUT",
    headers: {},
    expiresAt: "2026-09-30T00:15:00Z",
    skipped: false as const,
  };
}

function deps(overrides: Partial<UploadDeps> = {}): UploadDeps {
  return {
    hash: vi.fn(async () => "a".repeat(64)),
    presign: vi.fn(async () => grant()),
    put: vi.fn(async (_grant, _file, onProgress) => {
      onProgress(0.5);
      onProgress(1);
    }),
    complete: vi.fn(async () => artifact()),
    ...overrides,
  };
}

function track() {
  const patches: Partial<UploadItem>[] = [];
  const state: Partial<UploadItem> = {};
  return {
    patches,
    state,
    update: (patch: Partial<UploadItem>) => {
      patches.push(patch);
      Object.assign(state, patch);
    },
  };
}

describe("artifact naming", () => {
  it("normalizes the URL path prefix like the Vite plugin", () => {
    expect(normalizeUrlPrefix("")).toBe("");
    expect(normalizeUrlPrefix("  /static/app  ")).toBe("static/app/");
    expect(normalizeUrlPrefix("static//app///")).toBe("static/app/");
    expect(normalizeUrlPrefix("https://cdn.example.com/static/app/?v=1#top")).toBe("static/app/");
    expect(normalizeUrlPrefix("./static\\app")).toBe("static/app/");
  });

  it("joins the prefix with the path relative to the build output", () => {
    expect(artifactNameFor("assets/app.js.map", "")).toBe("assets/app.js.map");
    expect(artifactNameFor("assets/app.js.map", "static/app")).toBe("static/app/assets/app.js.map");
    expect(artifactNameFor("./assets\\app.js.map", "/cdn/")).toBe("cdn/assets/app.js.map");
  });

  it("keeps folder structure below the chosen folder and ignores non-map files", () => {
    const { files, ignored } = selectedFilesFrom([
      mapFile("index-abc.js.map", { folderPath: "dist/assets/index-abc.js.map" }),
      mapFile("index-abc.js", { folderPath: "dist/assets/index-abc.js" }),
      mapFile("vendor.js.map", { folderPath: "dist/assets/chunks/vendor.js.map" }),
    ]);
    expect(files.map((file) => file.relativePath)).toEqual([
      "assets/chunks/vendor.js.map",
      "assets/index-abc.js.map",
    ]);
    expect(ignored).toBe(1);
  });

  it("uses the file name for individually picked files", () => {
    const { files } = selectedFilesFrom([mapFile("app.js.map")]);
    expect(files[0].relativePath).toBe("app.js.map");
  });
});

describe("upload planning", () => {
  it("rejects oversized files and duplicate names before hashing", () => {
    const items = planUploads(
      [
        { file: mapFile("a.js.map"), relativePath: "a.js.map" },
        {
          file: mapFile("big.js.map", { size: MAX_ARTIFACT_BYTES + 1 }),
          relativePath: "big.js.map",
        },
        { file: mapFile("a.js.map"), relativePath: "a.js.map" },
      ],
      "static/",
    );
    expect(items.map((item) => [item.artifactName, item.status, item.error?.code])).toEqual([
      ["static/a.js.map", "waiting", undefined],
      ["static/big.js.map", "failed", "ARTIFACT_TOO_LARGE"],
      ["static/a.js.map", "failed", "DUPLICATE_NAME"],
    ]);
    expect(items[1].error?.message).toContain("64 MiB");
  });
});

describe("error messages", () => {
  const cases: Array<[string, string, boolean]> = [
    ["OBJECT_STORAGE_NOT_CONFIGURED", "实例尚未配置对象存储", false],
    ["OBJECT_STORAGE_UNAVAILABLE", "对象存储暂时不可用", false],
    ["ARTIFACT_MISMATCH", "SHA-256", false],
    ["ARTIFACT_EXISTS", "可替换", true],
    ["ARTIFACT_TOO_LARGE", "64 MiB", false],
  ];
  it.each(cases)("explains %s", (code, text, canReplace) => {
    const failure = describeUploadError(new HTTPError(400, code, "req", "server text"));
    expect(failure.code).toBe(code);
    expect(failure.message).toContain(text);
    expect(failure.canReplace).toBe(canReplace);
  });

  it("points at CORS for direct storage failures", () => {
    expect(describeUploadError(new ObjectUploadError(403)).message).toContain("HTTP 403");
    expect(describeUploadError(new ObjectUploadError(0)).message).toContain("CORS");
  });

  it("falls back to the server message for unknown codes", () => {
    expect(describeUploadError(new HTTPError(500, "BOOM", "", "服务端错误")).message).toBe(
      "服务端错误",
    );
  });
});

describe("uploadOne", () => {
  it("hashes, presigns, uploads with progress and completes", async () => {
    const dependencies = deps();
    const tracker = track();
    await uploadOne(
      { file: mapFile("app.js.map"), artifactName: "assets/app.js.map" },
      dependencies,
      tracker.update,
    );
    expect(dependencies.presign).toHaveBeenCalledWith({
      artifactName: "assets/app.js.map",
      sha256: "a".repeat(64),
      sizeBytes: 2,
    });
    expect(tracker.patches.map((patch) => patch.status).filter(Boolean)).toEqual([
      "hashing",
      "uploading",
      "verifying",
      "ready",
    ]);
    expect(tracker.patches.some((patch) => patch.progress === 0.5)).toBe(true);
    expect(dependencies.complete).toHaveBeenCalledWith("artifact-1");
  });

  it("skips identical content without uploading", async () => {
    const dependencies = deps({
      presign: vi.fn(async () => ({ artifact: artifact(), skipped: true as const })),
    });
    const tracker = track();
    await uploadOne(
      { file: mapFile("a.map"), artifactName: "a.map" },
      dependencies,
      tracker.update,
    );
    expect(tracker.state.status).toBe("skipped");
    expect(dependencies.put).not.toHaveBeenCalled();
    expect(dependencies.complete).not.toHaveBeenCalled();
  });

  it("offers replacement for ARTIFACT_EXISTS and retries with replace:true", async () => {
    const presign = vi
      .fn<UploadDeps["presign"]>()
      .mockRejectedValueOnce(new HTTPError(409, "ARTIFACT_EXISTS", "", "exists"))
      .mockResolvedValueOnce(grant());
    const dependencies = deps({ presign });
    const tracker = track();
    const item = { file: mapFile("a.map"), artifactName: "a.map" };
    await uploadOne(item, dependencies, tracker.update);
    expect(tracker.state.status).toBe("failed");
    expect(tracker.state.error?.canReplace).toBe(true);

    await uploadOne(item, dependencies, tracker.update, { replace: true });
    expect(presign).toHaveBeenLastCalledWith(expect.objectContaining({ replace: true }));
    expect(tracker.state.status).toBe("ready");
    expect(tracker.state.error).toBeUndefined();
  });

  it("shows the artifact error message when completion leaves it failed", async () => {
    const dependencies = deps({
      complete: vi.fn(async () =>
        artifact({ status: "failed", errorMessage: "不是有效的 Source Map" }),
      ),
    });
    const tracker = track();
    await uploadOne(
      { file: mapFile("a.map"), artifactName: "a.map" },
      dependencies,
      tracker.update,
    );
    expect(tracker.state.status).toBe("failed");
    expect(tracker.state.error?.message).toBe("不是有效的 Source Map");
  });

  it("maps ARTIFACT_MISMATCH from completion", async () => {
    const dependencies = deps({
      complete: vi.fn(async () => {
        throw new HTTPError(422, "ARTIFACT_MISMATCH", "", "mismatch");
      }),
    });
    const tracker = track();
    await uploadOne(
      { file: mapFile("a.map"), artifactName: "a.map" },
      dependencies,
      tracker.update,
    );
    expect(tracker.state.error?.code).toBe("ARTIFACT_MISMATCH");
  });

  it("never hashes a file over the limit", async () => {
    const dependencies = deps();
    const tracker = track();
    await uploadOne(
      { file: mapFile("big.map", { size: MAX_ARTIFACT_BYTES + 1 }), artifactName: "big.map" },
      dependencies,
      tracker.update,
    );
    expect(dependencies.hash).not.toHaveBeenCalled();
    expect(tracker.state.error?.code).toBe("ARTIFACT_TOO_LARGE");
  });
});

describe("runWithConcurrency", () => {
  it("keeps at most the limit in flight and processes every item", async () => {
    let inFlight = 0;
    let peak = 0;
    const done: number[] = [];
    await runWithConcurrency([1, 2, 3, 4, 5, 6, 7], 3, async (value) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, value % 3));
      inFlight -= 1;
      done.push(value);
    });
    expect(peak).toBe(3);
    expect(done.sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("handles an empty list", async () => {
    const worker = vi.fn(async () => undefined);
    await runWithConcurrency([], 3, worker);
    expect(worker).not.toHaveBeenCalled();
  });
});

describe("summarizeUploads", () => {
  it("counts terminal and active states", () => {
    const base = {
      file: mapFile("a.map"),
      relativePath: "a.map",
      artifactName: "a.map",
      progress: 0,
    };
    expect(
      summarizeUploads([
        { ...base, id: "1", status: "ready" },
        { ...base, id: "2", status: "skipped" },
        { ...base, id: "3", status: "failed" },
        { ...base, id: "4", status: "uploading" },
      ]),
    ).toEqual({ ready: 1, skipped: 1, failed: 1, active: 1 });
  });
});
