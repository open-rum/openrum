import { describe, expect, it } from "vitest";
import {
  AVATAR_BATCH_SIZE,
  AVATAR_STYLES,
  avatarUrl,
  generatedAvatar,
  initials,
  parseAvatar,
  randomBatch,
  randomSeed,
} from "./avatar";

const hash = "ab".repeat(16);

describe("avatar references", () => {
  it("parses generated and uploaded references", () => {
    expect(parseAvatar("dicebear:lorelei:abc123")).toEqual({
      kind: "generated",
      style: "lorelei",
      seed: "abc123",
    });
    expect(parseAvatar(`upload:${hash}`)).toEqual({ kind: "upload", hash });
  });

  it.each([
    "",
    null,
    undefined,
    "lorelei:abc",
    "dicebear:lorelei",
    "dicebear:fun-emoji:abc",
    "dicebear:lorelei:a b",
    "dicebear:lorelei:a/b",
    "dicebear:lorelei:a:b",
    "dicebear:lorelei:person@example.com",
    `dicebear:lorelei:${"x".repeat(41)}`,
    "upload:short",
    `upload:${hash.toUpperCase()}`,
    "https://evil.example/avatar.svg",
  ])("treats %j as no avatar", (value) => {
    expect(parseAvatar(value)).toBeNull();
    expect(avatarUrl("user-1", value)).toBeUndefined();
  });

  it("loads a generated avatar from DiceBear with the seed and no personal data", () => {
    const url = new URL(avatarUrl("user-1", "dicebear:notionists:seed42")!);
    expect(url.origin).toBe("https://api.dicebear.com");
    expect(url.pathname).toBe("/10.x/notionists/svg");
    expect(url.searchParams.get("seed")).toBe("seed42");
    expect(url.searchParams.get("backgroundColor")).toBeTruthy();
    // The user's own id never reaches the avatar service.
    expect(url.href).not.toContain("user-1");
  });

  it("serves an uploaded picture from the API, keyed by hash so a new picture is a new address", () => {
    expect(avatarUrl("a b", `upload:${hash}`)).toBe(`/api/v1/users/a%20b/avatar?v=${hash}`);
  });

  it("round-trips what generatedAvatar builds", () => {
    for (const style of AVATAR_STYLES)
      expect(parseAvatar(generatedAvatar(style, "s1"))).toMatchObject({ style, seed: "s1" });
  });
});

describe("random avatars", () => {
  it("makes a seed that is plain text and different each time", () => {
    const seeds = new Set(Array.from({ length: 50 }, () => randomSeed()));
    expect(seeds.size).toBe(50);
    for (const seed of seeds) expect(seed).toMatch(/^[a-z0-9]{12}$/);
  });

  it("offers a full batch that mixes every style evenly, each with its own seed", () => {
    const batch = randomBatch();
    expect(batch).toHaveLength(AVATAR_BATCH_SIZE);
    const parsed = batch.map((value) => parseAvatar(value));
    expect(parsed.every(Boolean)).toBe(true);
    const perStyle = new Map<string, number>();
    for (const item of parsed) {
      if (item?.kind === "generated") perStyle.set(item.style, (perStyle.get(item.style) ?? 0) + 1);
    }
    expect([...perStyle.keys()].sort()).toEqual([...AVATAR_STYLES].sort());
    expect(new Set(perStyle.values())).toEqual(new Set([AVATAR_BATCH_SIZE / AVATAR_STYLES.length]));
    const seeds = parsed.map((item) => (item?.kind === "generated" ? item.seed : ""));
    expect(new Set(seeds).size).toBe(AVATAR_BATCH_SIZE);
  });

  it("gives a different batch the next time", () => {
    const first = new Set(randomBatch());
    expect(randomBatch().some((value) => first.has(value))).toBe(false);
  });
});

describe("initials", () => {
  it("takes the first letters of the first two words", () => {
    expect(initials("OpenRUM Demo")).toBe("OD");
    expect(initials("  ada  lovelace byron ")).toBe("AL");
    expect(initials("OpenRUM")).toBe("O");
    expect(initials("")).toBe("");
  });
});
