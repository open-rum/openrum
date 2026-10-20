// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAvatarStatus, setAvatar, uploadAvatar } from "@/lib/api/avatar";
import { randomBatch } from "@/lib/avatar";
import { AvatarImageError, squareAvatarPng } from "@/lib/avatarImage";
import { HTTPError, type SessionUser } from "@/lib/auth/session";
import { AvatarPicker } from "./AvatarPicker";

vi.mock("@/lib/api/avatar", async (original) => ({
  ...(await original<typeof import("@/lib/api/avatar")>()),
  getAvatarStatus: vi.fn(),
  setAvatar: vi.fn(),
  uploadAvatar: vi.fn(),
}));
vi.mock("@/lib/avatar", async (original) => ({
  ...(await original<typeof import("@/lib/avatar")>()),
  randomBatch: vi.fn(),
}));
vi.mock("@/lib/avatarImage", async (original) => ({
  ...(await original<typeof import("@/lib/avatarImage")>()),
  squareAvatarPng: vi.fn(),
}));

const first = Array.from({ length: 12 }, (_, index) => `dicebear:lorelei:first${index}`);
const second = Array.from({ length: 12 }, (_, index) => `dicebear:thumbs:second${index}`);

function user(overrides: Partial<SessionUser> = {}): SessionUser {
  return { userId: "u1", email: "ada@example.test", displayName: "Ada Lovelace", ...overrides };
}

function renderPicker(account: SessionUser = user()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const view = render(
    <QueryClientProvider client={client}>
      <AvatarPicker user={account} />
    </QueryClientProvider>,
  );
  return { view, invalidate };
}

const candidates = () => screen.getAllByRole("button", { name: /^选择候选头像/ });
const sources = () =>
  candidates().map((button) => button.querySelector("img")!.getAttribute("src") ?? "");

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(randomBatch).mockReturnValueOnce(first).mockReturnValue(second);
  vi.mocked(getAvatarStatus).mockResolvedValue({
    uploadAvailable: false,
    maxUploadBytes: 524288,
    styles: ["lorelei"],
  });
});
afterEach(cleanup);

describe("picking a generated avatar", () => {
  it("offers twelve candidates, loaded from DiceBear without a referrer", async () => {
    renderPicker();
    expect(candidates()).toHaveLength(12);
    const image = candidates()[0].querySelector("img")!;
    expect(image.getAttribute("src")).toContain("api.dicebear.com/10.x/lorelei/svg?seed=first0");
    expect(image.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(image.getAttribute("alt")).toBe("");
  });

  it("saves a candidate as soon as it is clicked", async () => {
    vi.mocked(setAvatar).mockResolvedValue({ avatar: first[2] });
    const { invalidate } = renderPicker();
    await userEvent.setup().click(candidates()[2]);

    expect(setAvatar).toHaveBeenCalledWith(first[2]);
    expect(await screen.findByText("头像已更新。")).toBeTruthy();
    // The session is read again so the menu and member lists show the new picture.
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["auth", "session"] });
  });

  it("marks the current avatar among the candidates", () => {
    renderPicker(user({ avatar: first[4] }));
    expect(candidates().map((button) => button.getAttribute("aria-pressed"))).toEqual(
      first.map((value) => String(value === first[4])),
    );
  });

  it("shows a different batch each time 换一批 is used", async () => {
    renderPicker();
    const before = sources();
    await userEvent.setup().click(screen.getByRole("button", { name: "换一批" }));
    const after = sources();
    expect(randomBatch).toHaveBeenCalledTimes(2);
    expect(after).toHaveLength(12);
    expect(after.some((source) => before.includes(source))).toBe(false);
    expect(after[0]).toContain("/thumbs/svg?seed=second0");
  });

  it("goes back to initials, and offers that only when there is a picture to remove", async () => {
    vi.mocked(setAvatar).mockResolvedValue({ avatar: null });
    renderPicker();
    expect(screen.queryByRole("button", { name: "恢复为首字母" })).toBeNull();
    cleanup();

    renderPicker(user({ avatar: first[0] }));
    await userEvent.setup().click(screen.getByRole("button", { name: "恢复为首字母" }));
    expect(setAvatar).toHaveBeenCalledWith(null);
    expect(await screen.findByText("已恢复为首字母头像。")).toBeTruthy();
  });

  it("explains a failed save", async () => {
    vi.mocked(setAvatar).mockRejectedValue(new Error("boom"));
    renderPicker();
    await userEvent.setup().click(candidates()[0]);
    expect((await screen.findByRole("alert")).textContent).toContain("保存头像失败：boom");
  });

  it("says the service is probably unreachable when half the candidates do not load", async () => {
    renderPicker();
    expect(screen.queryByText(/没有加载出来/)).toBeNull();
    for (const button of candidates().slice(0, 6)) fireEvent.error(button.querySelector("img")!);
    expect(await screen.findByText(/当前网络可能无法访问 api\.dicebear\.com/)).toBeTruthy();
    // A fresh batch clears the warning.
    await userEvent.setup().click(screen.getByRole("button", { name: "换一批" }));
    expect(screen.queryByText(/没有加载出来/)).toBeNull();
  });

  it("is honest that default avatars involve a third-party request", () => {
    renderPicker();
    expect(screen.getByText(/浏览器会向 api\.dicebear\.com 请求图片/)).toBeTruthy();
  });
});

describe("uploading a picture", () => {
  it("is unavailable until object storage is configured, and says so", async () => {
    renderPicker();
    expect(await screen.findByText(/上传头像需要先配置对象存储/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "上传图片" }).hasAttribute("disabled")).toBe(true);
    // An ordinary member is told who can fix it; there is no link they could not use.
    expect(screen.getByText(/请联系实例管理员/)).toBeTruthy();
    expect(screen.queryByRole("link", { name: "去配置对象存储" })).toBeNull();
    // Generated avatars do not need it.
    expect(candidates()[0].hasAttribute("disabled")).toBe(false);
  });

  it("points an instance administrator to the storage settings", async () => {
    renderPicker(user({ instanceRole: "instance_owner" }));
    const link = await screen.findByRole("link", { name: "去配置对象存储" });
    expect(link.getAttribute("href")).toBe("/settings/instance/object-storage");
  });

  it("cuts the chosen image to a square and uploads that", async () => {
    vi.mocked(getAvatarStatus).mockResolvedValue({
      uploadAvailable: true,
      maxUploadBytes: 524288,
      styles: [],
    });
    const square = new Blob(["png"], { type: "image/png" });
    vi.mocked(squareAvatarPng).mockResolvedValue(square);
    vi.mocked(uploadAvatar).mockResolvedValue({ avatar: `upload:${"a".repeat(32)}` });
    renderPicker();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "上传图片" }).hasAttribute("disabled")).toBe(false),
    );
    expect(screen.queryByText(/上传头像需要先配置对象存储/)).toBeNull();

    const file = new File(["raw"], "me.jpg", { type: "image/jpeg" });
    await userEvent.setup().upload(screen.getByLabelText("选择头像图片"), file);

    await waitFor(() => expect(uploadAvatar).toHaveBeenCalledWith(square));
    expect(squareAvatarPng).toHaveBeenCalledWith(file);
    expect(await screen.findByText("头像已更新。")).toBeTruthy();
  });

  it("shows why an image was refused before anything is sent", async () => {
    vi.mocked(getAvatarStatus).mockResolvedValue({
      uploadAvailable: true,
      maxUploadBytes: 1,
      styles: [],
    });
    vi.mocked(squareAvatarPng).mockRejectedValue(new AvatarImageError("图片不能超过 10 MB。"));
    renderPicker();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "上传图片" }).hasAttribute("disabled")).toBe(false),
    );
    await userEvent
      .setup()
      .upload(
        screen.getByLabelText("选择头像图片"),
        new File(["x"], "big.png", { type: "image/png" }),
      );

    expect((await screen.findByRole("alert")).textContent).toBe("图片不能超过 10 MB。");
    expect(uploadAvatar).not.toHaveBeenCalled();
  });

  it.each([
    ["OBJECT_STORAGE_UNAVAILABLE", "对象存储现在不可用"],
    ["AVATAR_TOO_LARGE", "图片太大了"],
    ["AVATAR_INVALID", "不能用作头像"],
  ])("explains the server's %s answer", async (code, text) => {
    vi.mocked(getAvatarStatus).mockResolvedValue({
      uploadAvailable: true,
      maxUploadBytes: 1,
      styles: [],
    });
    vi.mocked(squareAvatarPng).mockResolvedValue(new Blob(["png"]));
    vi.mocked(uploadAvatar).mockRejectedValue(new HTTPError(400, code, "", "server words"));
    renderPicker();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "上传图片" }).hasAttribute("disabled")).toBe(false),
    );
    await userEvent
      .setup()
      .upload(
        screen.getByLabelText("选择头像图片"),
        new File(["x"], "a.png", { type: "image/png" }),
      );
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText(new RegExp(text))).toBeTruthy();
  });
});
