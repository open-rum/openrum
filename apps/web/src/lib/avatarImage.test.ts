// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AVATAR_PIXELS,
  AvatarImageError,
  MAX_SOURCE_BYTES,
  centreSquare,
  squareAvatarPng,
} from "./avatarImage";

afterEach(() => vi.unstubAllGlobals());

describe("centreSquare", () => {
  it("crops the middle of a wide or tall picture", () => {
    expect(centreSquare(400, 200)).toEqual({ sx: 100, sy: 0, side: 200 });
    expect(centreSquare(200, 400)).toEqual({ sx: 0, sy: 100, side: 200 });
    expect(centreSquare(300, 300)).toEqual({ sx: 0, sy: 0, side: 300 });
    expect(centreSquare(301, 100)).toEqual({ sx: 100, sy: 0, side: 100 });
  });
});

function stubDecoding(width: number, height: number) {
  const close = vi.fn();
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => ({ width, height, close })),
  );
  const drawImage = vi.fn();
  const context = { drawImage, imageSmoothingQuality: "low" };
  const canvases: HTMLCanvasElement[] = [];
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (
    this: HTMLCanvasElement,
  ) {
    canvases.push(this);
    return context as unknown as CanvasRenderingContext2D;
  });
  const png = new Blob(["png"], { type: "image/png" });
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => callback(png));
  return { close, drawImage, canvases, png };
}

describe("squareAvatarPng", () => {
  it("draws the centred square into a canvas of the avatar size and returns its PNG", async () => {
    const { close, drawImage, canvases, png } = stubDecoding(600, 400);
    const result = await squareAvatarPng(new File(["x"], "me.jpg", { type: "image/jpeg" }));
    expect(result).toBe(png);
    expect(drawImage).toHaveBeenCalledWith(
      expect.anything(),
      100,
      0,
      400,
      400,
      0,
      0,
      AVATAR_PIXELS,
      AVATAR_PIXELS,
    );
    expect(canvases[0].width).toBe(AVATAR_PIXELS);
    expect(canvases[0].height).toBe(AVATAR_PIXELS);
    expect(close).toHaveBeenCalled();
  });

  it.each(["image/svg+xml", "text/html", "application/pdf", ""])(
    "refuses %j before decoding",
    async (type) => {
      const { drawImage } = stubDecoding(100, 100);
      await expect(squareAvatarPng(new File(["x"], "f", { type }))).rejects.toBeInstanceOf(
        AvatarImageError,
      );
      expect(drawImage).not.toHaveBeenCalled();
    },
  );

  it("refuses a source that is too large without decoding it", async () => {
    const decode = vi.fn();
    vi.stubGlobal("createImageBitmap", decode);
    const big = new File(["x"], "big.png", { type: "image/png" });
    Object.defineProperty(big, "size", { value: MAX_SOURCE_BYTES + 1 });
    await expect(squareAvatarPng(big)).rejects.toThrow("10 MB");
    expect(decode).not.toHaveBeenCalled();
  });

  it("refuses a picture that is too small, and still releases it", async () => {
    const { close } = stubDecoding(20, 500);
    await expect(squareAvatarPng(new File(["x"], "s.png", { type: "image/png" }))).rejects.toThrow(
      "太小",
    );
    expect(close).toHaveBeenCalled();
  });

  it("says so when the browser cannot read the file", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => {
        throw new Error("corrupt");
      }),
    );
    await expect(
      squareAvatarPng(new File(["x"], "bad.png", { type: "image/png" })),
    ).rejects.toThrow("无法读取");
  });
});
