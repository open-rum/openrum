// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HTTPError } from "@/lib/auth/session";
import {
  completeArtifact,
  deleteRelease,
  getSourceMapStatus,
  listArtifacts,
  listReleases,
  presignArtifact,
  putArtifactBytes,
  type Release,
} from "@/lib/api/releases";
import { SourceMapPage } from "./ReleasesPage";

const toastSuccess = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: vi.fn() } }));
vi.mock("@tanstack/react-router", () => ({ useParams: () => ({ projectId: "project-1" }) }));
// The token list has its own tests and its own requests; here it only has to be on the page.
vi.mock("@/features/settings/UploadTokensSection", () => ({
  UploadTokensSection: () => <section aria-label="上传令牌区">tokens</section>,
}));
vi.mock("@/lib/api/projects", () => ({
  listOrganizations: async () => ({ organizations: [{ id: "org-1" }] }),
  listProjects: async () => ({ projects: [{ id: "project-1", name: "Web", role: "owner" }] }),
}));
vi.mock("@/lib/auth/session", async (original) => ({
  ...(await original<typeof import("@/lib/auth/session")>()),
  sessionQueryOptions: () => ({
    queryKey: ["auth", "session"],
    queryFn: async () => ({
      userId: "u1",
      email: "a@b.c",
      displayName: "A",
      instanceRole: "instance_admin",
    }),
  }),
}));
// The hold gesture has its own tests; here a click stands in for a completed hold.
vi.mock("@/components/ui/hold-button", () => ({
  HoldButton: ({
    children,
    onHold,
    disabled,
    "aria-label": label,
  }: {
    children: React.ReactNode;
    onHold?: () => void;
    disabled?: boolean;
    "aria-label"?: string;
  }) => (
    <button type="button" aria-label={label} disabled={disabled} onClick={onHold}>
      {children}
    </button>
  ),
}));
vi.mock("@/lib/api/releases", async (original) => ({
  ...(await original<typeof import("@/lib/api/releases")>()),
  listReleases: vi.fn(),
  createRelease: vi.fn(),
  deleteRelease: vi.fn(),
  getSourceMapStatus: vi.fn(),
  listArtifacts: vi.fn(),
  presignArtifact: vi.fn(),
  putArtifactBytes: vi.fn(),
  completeArtifact: vi.fn(),
  sha256Hex: vi.fn(async () => "b".repeat(64)),
  testSourceMap: vi.fn(),
}));

const now = "2026-09-30T00:00:00Z";
function release(overrides: Partial<Release> = {}): Release {
  return {
    id: "release-1",
    projectId: "project-1",
    version: "web@1.0.0",
    dist: "",
    commitSha: "abc123",
    deployedAt: now,
    createdAt: now,
    updatedAt: now,
    artifactCount: 3,
    readyCount: 2,
    ...overrides,
  };
}
function artifact(name: string, status: "pending" | "ready" | "failed" = "ready") {
  return {
    id: `artifact-${name}`,
    releaseId: "release-1",
    artifactName: name,
    sizeBytes: 12,
    status,
    createdAt: now,
    updatedAt: now,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState({}, "", "/settings/project/project-1/sourcemaps");
  vi.mocked(getSourceMapStatus).mockResolvedValue({
    storage: "ready",
    maxArtifactBytes: 64 * 1024 * 1024,
    remapWindowDays: 7,
    deleteAllowed: true,
  });
  vi.mocked(listReleases).mockImplementation(async (_project, options = {}) => {
    if (options.cursor === "page-2")
      return { releases: [release({ id: "release-3", version: "web@0.9.0" })], nextCursor: null };
    if (options.q === "2.0")
      return { releases: [release({ id: "release-2", version: "web@2.0.0" })], nextCursor: null };
    return { releases: [release()], nextCursor: "page-2" };
  });
  vi.mocked(listArtifacts).mockResolvedValue({ artifacts: [] });
});
afterEach(cleanup);

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <SourceMapPage />
    </QueryClientProvider>,
  );
}

describe("releases list", () => {
  it("shows ready/total counts, searches by version and loads more pages", async () => {
    const view = renderPage();
    const list = await view.findByLabelText("版本列表");
    expect(within(list).getByText("web@1.0.0")).toBeTruthy();
    expect(within(list).getByLabelText("2 个可用，共 3 个文件")).toBeTruthy();

    fireEvent.click(view.getByRole("button", { name: "加载更多" }));
    await waitFor(() => expect(within(list).getByText("web@0.9.0")).toBeTruthy());
    expect(listReleases).toHaveBeenCalledWith(
      "project-1",
      expect.objectContaining({ cursor: "page-2" }),
      expect.anything(),
    );

    fireEvent.change(view.getByLabelText("搜索版本"), { target: { value: "2.0" } });
    await waitFor(() =>
      expect(within(view.getByLabelText("版本列表")).getByText("web@2.0.0")).toBeTruthy(),
    );
    expect(listReleases).toHaveBeenCalledWith(
      "project-1",
      expect.objectContaining({ q: "2.0" }),
      expect.anything(),
    );
  });

  it("deletes a release after the hold and confirms with a toast", async () => {
    vi.mocked(deleteRelease).mockResolvedValue(undefined);
    const view = renderPage();
    fireEvent.click(await view.findByRole("button", { name: "长按删除版本 web@1.0.0" }));
    await waitFor(() => expect(deleteRelease).toHaveBeenCalledWith("project-1", "release-1"));
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith("已删除版本 web@1.0.0 及其 Source Map"),
    );
  });
});

describe("layout", () => {
  it("puts the selected release's files beside the list", async () => {
    const view = renderPage();
    const list = await view.findByLabelText("版本列表");
    const layout = list.closest(".releases-layout")!;
    expect(layout).toBeTruthy();
    // Time and commit are said once, in the detail header, not repeated on every list row.
    expect(within(list as HTMLElement).queryByText(/部署于/)).toBeNull();
    const detail = layout.querySelector(".releases-detail") as HTMLElement;
    expect(within(detail).getByText("web@1.0.0")).toBeTruthy();
    expect(within(detail).getByText(/部署于/)).toBeTruthy();
    expect(within(detail).getByText("abc123")).toBeTruthy();
    expect(within(detail).getByText("匹配测试")).toBeTruthy();
  });

  it("keeps setup out of the way once versions exist, closed unless a link asks for tokens", async () => {
    const view = renderPage();
    await view.findByLabelText("版本列表");
    const access = view.getByText("接入与上传令牌").closest("details")!;
    expect(access.open).toBe(false);
    expect(view.queryByText("第一次使用：三步让 Source Map 生效")).toBeNull();
    view.unmount();

    window.history.replaceState({}, "", "/settings/project/project-1/sourcemaps#upload-tokens");
    const again = renderPage();
    await again.findByLabelText("版本列表");
    expect((again.getByText("接入与上传令牌").closest("details") as HTMLDetailsElement).open).toBe(
      true,
    );
  });
});

describe("a project with no release yet", () => {
  beforeEach(() => {
    vi.mocked(listReleases).mockResolvedValue({ releases: [], nextCursor: null });
  });

  it("shows the three setup steps, with the token list and the build snippet in them", async () => {
    const view = renderPage();
    expect(await view.findByText("第一次使用：三步让 Source Map 生效")).toBeTruthy();
    const steps = view.getAllByRole("listitem").filter((item) => item.querySelector("h3"));
    expect(steps.map((step) => step.querySelector("h3")?.textContent)).toEqual([
      "创建上传令牌",
      "配置构建插件",
      "构建并发布",
    ]);
    expect(within(steps[0]).getByLabelText("上传令牌区")).toBeTruthy();
    expect(within(steps[1]).getByText(/openRUMSourceMaps/)).toBeTruthy();
    // The empty list and the "details" fold are not shown on top of the guide.
    expect(view.queryByLabelText("版本列表")).toBeNull();
    expect(view.queryByText("接入与上传令牌")).toBeNull();
  });

  it("does not mistake a search with no match for a new project", async () => {
    vi.mocked(listReleases).mockImplementation(async (_project, options = {}) =>
      options.q ? { releases: [], nextCursor: null } : { releases: [release()], nextCursor: null },
    );
    const view = renderPage();
    await view.findByLabelText("版本列表");
    fireEvent.change(view.getByLabelText("搜索版本"), { target: { value: "nope" } });
    expect(await view.findByText("没有包含“nope”的版本。")).toBeTruthy();
    expect(view.queryByText("第一次使用：三步让 Source Map 生效")).toBeNull();
  });
});

describe("storage status", () => {
  it("explains missing storage and links instance admins to the settings", async () => {
    vi.mocked(getSourceMapStatus).mockResolvedValue({
      storage: "not_configured",
      maxArtifactBytes: 64 * 1024 * 1024,
      remapWindowDays: 7,
      deleteAllowed: true,
    });
    const view = renderPage();
    expect(await view.findByText("尚未配置对象存储")).toBeTruthy();
    await waitFor(() =>
      expect(view.getByText("前往配置对象存储").getAttribute("href")).toBe(
        "/settings/instance/object-storage",
      ),
    );
    await waitFor(() =>
      expect((view.getByLabelText("选择 Source Map 文件") as HTMLInputElement).disabled).toBe(true),
    );
  });
});

describe("storage without delete permission", () => {
  it("keeps uploads available and notes, beside the delete controls, that files are kept", async () => {
    vi.mocked(getSourceMapStatus).mockResolvedValue({
      storage: "ready",
      maxArtifactBytes: 64 * 1024 * 1024,
      remapWindowDays: 7,
      deleteAllowed: false,
    });
    const view = renderPage();
    expect(await view.findByText("删除受限")).toBeTruthy();
    expect(view.queryByText("对象存储没有删除权限")).toBeNull();
    expect(view.queryByText("尚未配置对象存储")).toBeNull();
  });
});

describe("release preselection", () => {
  it("selects the release named in the URL", async () => {
    window.history.replaceState(
      {},
      "",
      "/settings/project/project-1/sourcemaps?release=web%402.0.0&dist=b",
    );
    vi.mocked(listReleases).mockImplementation(async (_project, options = {}) =>
      options.q === "web@2.0.0"
        ? {
            releases: [
              release({ id: "release-2a", version: "web@2.0.0", dist: "" }),
              release({ id: "release-2b", version: "web@2.0.0", dist: "b" }),
            ],
            nextCursor: null,
          }
        : { releases: [release()], nextCursor: null },
    );
    const view = renderPage();
    const heading = await view.findByRole("button", { name: "长按删除版本 web@2.0.0" });
    expect(heading).toBeTruthy();
    expect(view.getAllByText("dist b").length).toBeGreaterThan(0);
  });

  it("prefills registration when the URL release does not exist", async () => {
    window.history.replaceState(
      {},
      "",
      "/settings/project/project-1/sourcemaps?release=web%403.0.0&dist=b",
    );
    const view = renderPage();
    await waitFor(() =>
      expect((view.getByPlaceholderText("web@2026.09.03") as HTMLInputElement).value).toBe(
        "web@3.0.0",
      ),
    );
    expect((view.getByPlaceholderText("留空表示默认") as HTMLInputElement).value).toBe("b");
    expect(view.getByText(/版本 web@3.0.0（dist b）尚未登记/)).toBeTruthy();
  });
});

describe("artifact upload", () => {
  it("names files with the URL prefix, uploads them and offers replacement on conflicts", async () => {
    vi.mocked(presignArtifact).mockImplementation(async (_project, _release, input) => {
      if (input.artifactName === "static/app/b.js.map" && !input.replace)
        throw new HTTPError(409, "ARTIFACT_EXISTS", "", "exists");
      return {
        artifact: { ...artifact(input.artifactName, "pending") },
        uploadUrl: "https://oss.example/put",
        method: "PUT",
        headers: {},
        expiresAt: now,
      };
    });
    vi.mocked(putArtifactBytes).mockImplementation(async (_grant, _file, onProgress) => {
      onProgress(1);
    });
    vi.mocked(completeArtifact).mockImplementation(async (_project, _release, id) =>
      artifact(id.replace(/^artifact-/, "")),
    );

    const view = renderPage();
    await view.findByLabelText("版本列表");
    fireEvent.change(view.getByPlaceholderText("例如 static/app/，站点根目录留空"), {
      target: { value: "/static/app" },
    });
    expect(view.getByTestId("artifact-name-example").textContent).toBe(
      "static/app/assets/index-abc123.js.map",
    );
    const input = view.getByLabelText("选择 Source Map 文件");
    fireEvent.change(input, {
      target: {
        files: [
          new File(["{}"], "a.js.map", { type: "application/json" }),
          new File(["{}"], "b.js.map", { type: "application/json" }),
          new File(["x"], "readme.txt", { type: "text/plain" }),
        ],
      },
    });
    expect(view.getByText("static/app/a.js.map")).toBeTruthy();
    expect(view.getByText(/忽略 1 个非 .map 文件/)).toBeTruthy();

    fireEvent.click(view.getByRole("button", { name: "上传 2 个文件" }));
    await waitFor(() => expect(view.getByText(/可用 1，跳过 0，失败 1/)).toBeTruthy());
    expect(presignArtifact).toHaveBeenCalledWith(
      "project-1",
      "release-1",
      expect.objectContaining({ artifactName: "static/app/a.js.map", sizeBytes: 2 }),
    );
    expect(view.getByText(/该版本已有同名 Source Map/)).toBeTruthy();

    fireEvent.click(view.getByRole("button", { name: "替换" }));
    await waitFor(() => expect(view.getByText(/可用 2，跳过 0，失败 0/)).toBeTruthy());
    expect(presignArtifact).toHaveBeenLastCalledWith(
      "project-1",
      "release-1",
      expect.objectContaining({ artifactName: "static/app/b.js.map", replace: true }),
    );
  });

  it("shows the stored error message of a failed artifact", async () => {
    vi.mocked(listArtifacts).mockResolvedValue({
      artifacts: [
        { ...artifact("assets/app.js.map", "failed"), errorMessage: "sha256 与声明不一致" },
      ],
    });
    const view = renderPage();
    expect(await view.findByText("sha256 与声明不一致")).toBeTruthy();
  });
});
