/**
 * A profile picture is stored as a short reference, never as image data:
 *   dicebear:<style>:<seed>   a generated avatar, drawn by the DiceBear service
 *   upload:<hash>             a picture the person uploaded, served by the OpenRUM API
 * No reference means no picture was chosen, and the Console shows initials.
 */

/**
 * Generated avatars come from the public DiceBear API. Loading one sends the viewer's address
 * and the seed to api.dicebear.com. The seed is random and says nothing about the person,
 * and images are requested without a referrer, so the instance's address is not sent either.
 */
export const DICEBEAR_BASE_URL = "https://api.dicebear.com/10.x";

/** CC0 styles only, so no attribution is owed. The server accepts exactly these. */
export const AVATAR_STYLES = ["lorelei", "notionists", "thumbs", "shapes"] as const;
export type AvatarStyle = (typeof AVATAR_STYLES)[number];

/** Soft backgrounds the generator picks from by seed, so transparent styles stay legible. */
const BACKGROUNDS = "b6e3f4,c0aede,d1d4f9,ffd5dc,ffdfbf";

export const AVATAR_BATCH_SIZE = 12;

export type ParsedAvatar =
  { kind: "generated"; style: AvatarStyle; seed: string } | { kind: "upload"; hash: string };

const SEED_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;
const HASH_PATTERN = /^[0-9a-f]{32}$/;

export function generatedAvatar(style: AvatarStyle, seed: string) {
  return `dicebear:${style}:${seed}`;
}

export function parseAvatar(value: string | null | undefined): ParsedAvatar | null {
  if (!value) return null;
  if (value.startsWith("upload:")) {
    const hash = value.slice("upload:".length);
    return HASH_PATTERN.test(hash) ? { kind: "upload", hash } : null;
  }
  const [prefix, style, seed, ...extra] = value.split(":");
  if (prefix !== "dicebear" || extra.length || !seed || !SEED_PATTERN.test(seed)) return null;
  if (!(AVATAR_STYLES as readonly string[]).includes(style)) return null;
  return { kind: "generated", style: style as AvatarStyle, seed };
}

/** Where the browser loads a person's picture from, or undefined when it should show initials. */
export function avatarUrl(userId: string, value: string | null | undefined) {
  const parsed = parseAvatar(value);
  if (!parsed) return undefined;
  if (parsed.kind === "upload")
    return `/api/v1/users/${encodeURIComponent(userId)}/avatar?v=${parsed.hash}`;
  return `${DICEBEAR_BASE_URL}/${parsed.style}/svg?seed=${encodeURIComponent(parsed.seed)}&backgroundColor=${BACKGROUNDS}`;
}

const SEED_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

/** An opaque random seed. It is never derived from a name or an email address. */
export function randomSeed(length = 12) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => SEED_ALPHABET[byte % SEED_ALPHABET.length]).join("");
}

/**
 * A batch of candidates that mixes every style evenly, so each batch offers a range of looks
 * and "换一批" does not repeat one. Seeds within a batch are distinct.
 */
export function randomBatch(size = AVATAR_BATCH_SIZE): string[] {
  const seen = new Set<string>();
  const batch: string[] = [];
  while (batch.length < size) {
    const seed = randomSeed();
    if (seen.has(seed)) continue;
    seen.add(seed);
    batch.push(generatedAvatar(AVATAR_STYLES[batch.length % AVATAR_STYLES.length], seed));
  }
  return batch;
}

/** The first letters of the first two words of a name, for when there is no picture. */
export function initials(displayName: string) {
  return displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}
