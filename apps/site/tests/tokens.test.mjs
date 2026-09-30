import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const tokens = await readFile(
  new URL("../../../packages/design-tokens/tokens.css", import.meta.url),
  "utf8",
);
const block = (selector) => {
  const start = tokens.indexOf(selector);
  assert.ok(start >= 0, `missing ${selector}`);
  return tokens.slice(start, tokens.indexOf("}", start));
};
const read = (css) =>
  Object.fromEntries(
    [...css.matchAll(/(--ds-[a-z0-9-]+):\s*(#[0-9a-f]{6});/gi)].map((m) => [m[1], m[2]]),
  );
const light = read(block(':root,\n[data-theme-scope="light"]'));
const dark = { ...light, ...read(block('.dark,\n[data-theme="dark"]')) };

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const linear = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}
function contrast(a, b) {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

const hues = ["amber", "lime", "sky", "magenta"];
// Canvas approximations of oklch(0.9851 0 0) and oklch(0.145 0 0).
const canvas = { light: "#fafafa", dark: "#0a0a0a" };

test("every card hue stays readable in both modes", () => {
  for (const [mode, values] of [
    ["light", light],
    ["dark", dark],
  ]) {
    for (const hue of hues) {
      const get = (role) => {
        const value = values[`--ds-${hue}-${role}`];
        assert.ok(value, `${mode} ${hue}-${role} is defined`);
        return value;
      };
      const pairs = [
        ["ink on soft", get("ink"), get("soft")],
        ["ink on canvas", get("ink"), canvas[mode]],
        ["foreground on solid", get("foreground"), get("solid")],
        ["on-action on action", get("on-action"), get("action")],
      ];
      for (const [name, text, background] of pairs) {
        assert.ok(
          contrast(text, background) >= 4.5,
          `${mode} ${hue} ${name}: ${contrast(text, background).toFixed(2)}`,
        );
      }
    }
  }
});

test("each palette makes one card hue primary and the other three accents", () => {
  for (const [palette, accents] of [
    ["amber", ["lime", "sky", "magenta"]],
    ["lime", ["amber", "sky", "magenta"]],
    ["magenta", ["amber", "lime", "sky"]],
  ]) {
    const css = block(
      palette === "amber" ? ':root,\n[data-palette="amber"]' : `[data-palette="${palette}"]`,
    );
    assert.match(css, new RegExp(`--ds-primary: var\\(--ds-${palette}-solid\\)`));
    accents.forEach((accent, index) =>
      assert.match(css, new RegExp(`--ds-accent-${index + 1}: var\\(--ds-${accent}-solid\\)`)),
    );
  }
  assert.doesNotMatch(tokens, /125\.59/, "the retired lime-only tokens are gone");
});
