/** An uploaded picture is cut to a square this many pixels on a side before it is sent. */
export const AVATAR_PIXELS = 256;
/** Larger source files are refused rather than decoded. */
export const MAX_SOURCE_BYTES = 10 << 20;

const ACCEPTED = ["image/png", "image/jpeg", "image/webp", "image/gif"];

export class AvatarImageError extends Error {}

/** The centred square of a width-by-height picture: where it starts and how long its side is. */
export function centreSquare(width: number, height: number) {
  const side = Math.min(width, height);
  return { sx: Math.floor((width - side) / 2), sy: Math.floor((height - side) / 2), side };
}

/**
 * Reads a picture the person chose and returns a square PNG of AVATAR_PIXELS. Drawing it on a
 * canvas keeps only the pixels, so location data and other metadata in the original is dropped
 * before anything is uploaded.
 */
export async function squareAvatarPng(file: File): Promise<Blob> {
  if (!ACCEPTED.includes(file.type))
    throw new AvatarImageError("请选择 PNG、JPEG、WebP 或 GIF 图片。");
  if (file.size > MAX_SOURCE_BYTES) throw new AvatarImageError("图片不能超过 10 MB。");
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new AvatarImageError("无法读取这张图片。");
  }
  try {
    const { sx, sy, side } = centreSquare(bitmap.width, bitmap.height);
    if (side < 32) throw new AvatarImageError("图片太小，请选择至少 32 像素见方的图片。");
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = AVATAR_PIXELS;
    const context = canvas.getContext("2d");
    if (!context) throw new AvatarImageError("这个浏览器不能处理图片。");
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, sx, sy, side, side, 0, 0, AVATAR_PIXELS, AVATAR_PIXELS);
    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!png) throw new AvatarImageError("无法处理这张图片。");
    return png;
  } finally {
    bitmap.close();
  }
}
