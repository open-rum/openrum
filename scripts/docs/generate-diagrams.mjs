// Renders the Mermaid sources in docs/diagrams/ to SVG before site previews and releases.
// Mermaid needs a DOM to measure text, so routine site builds consume the generated SVG
// without launching a headless browser. Rendering is validated by the site workflows;
// generated SVG bytes are not compared across operating systems.
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { chromium } from "@playwright/test";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const sourceDirectory = join(root, "docs/diagrams");
const outputDirectory = join(root, "apps/site/src/assets/diagrams");

const sources = (await readdir(sourceDirectory)).filter((name) => name.endsWith(".mmd")).sort();
if (sources.length === 0) {
  console.error("No Mermaid sources found in docs/diagrams.");
  process.exit(1);
}

await mkdir(outputDirectory, { recursive: true });

const mermaidScript = await readFile(
  createRequire(import.meta.url).resolve("mermaid/dist/mermaid.min.js"),
  "utf8",
);

// Mermaid validates every theme variable with a real colour parser and derives further
// shades from them, so design tokens cannot be handed to it directly. It is fed sentinel
// colours instead, which are swapped for tokens in the rendered SVG; one committed diagram
// then follows the reader's theme. Sentinels are far enough apart that a derived shade
// never collides with another sentinel.
const palette = {
  "#101001": "var(--ds-surface-subtle)",
  "#101002": "var(--ds-border)",
  "#101003": "var(--ds-text)",
  "#101004": "var(--ds-text-muted)",
  "#101005": "var(--ds-canvas)",
  // Mermaid always emits these two rules, for its own parse-error text and for a shape
  // variant no diagram here uses. Neither ever matches, but the design-token gate rejects
  // raw colour literals anywhere under apps/site/src, so they are mapped as well.
  "#efeffe": "var(--ds-danger)",
  "#000000": "var(--ds-text)",
};
const themeVariables = {
  background: "transparent",
  primaryColor: "#101001",
  mainBkg: "#101001",
  secondaryColor: "#101001",
  tertiaryColor: "#101001",
  primaryBorderColor: "#101002",
  nodeBorder: "#101002",
  primaryTextColor: "#101003",
  nodeTextColor: "#101003",
  textColor: "#101003",
  titleColor: "#101003",
  lineColor: "#101004",
  edgeLabelBackground: "#101005",
  fontFamily: '"Geist Variable", sans-serif',
  fontSize: "15px",
};

// Mermaid measures every label to size its boxes, so the render page has to have the font
// the site actually ships. Without it the measurements come from a fallback face and the
// committed SVG clips its own labels once the browser renders them in Geist.
const geist = await readFile(
  // Resolved through the site package, which is what depends on the font.
  createRequire(join(root, "apps/site/package.json")).resolve(
    "@fontsource-variable/geist/files/geist-latin-wght-normal.woff2",
  ),
);

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent("<!doctype html><html><body></body></html>");
await page.addStyleTag({
  content: `@font-face {
    font-family: "Geist Variable";
    font-weight: 100 900;
    src: url(data:font/woff2;base64,${geist.toString("base64")}) format("woff2-variations");
  }`,
});
await page.evaluate(() => document.fonts.ready.then(() => true));
await page.addScriptTag({ content: mermaidScript });

let failed = false;
for (const source of sources) {
  const definition = await readFile(join(sourceDirectory, source), "utf8");
  const svg = await page.evaluate(
    async ([definition, themeVariables]) => {
      const mermaid = globalThis.mermaid;
      mermaid.initialize({
        startOnLoad: false,
        theme: "base",
        themeVariables,
        flowchart: { curve: "basis", useMaxWidth: true },
      });
      const { svg } = await mermaid.render("diagram", definition);
      return svg;
    },
    [definition, themeVariables],
  );

  // Mermaid emits an id-scoped <style> block and an aria label; both are kept so the
  // inlined SVG stays self-contained and announced.
  let contents = svg.replace(/<br>/g, "<br/>");
  for (const [sentinel, token] of Object.entries(palette)) {
    contents = contents.replaceAll(new RegExp(sentinel, "gi"), token);
  }
  const leaked = [...new Set(contents.match(/#[0-9a-f]{6}\b/gi) ?? [])];
  if (leaked.length > 0) {
    console.error(
      `${source} rendered with colours outside the palette: ${leaked.join(", ")}. Map them in scripts/docs/generate-diagrams.mjs.`,
    );
    failed = true;
    continue;
  }
  contents = `${contents.trimEnd()}\n`;
  const target = join(outputDirectory, `${basename(source, ".mmd")}.svg`);
  await writeFile(target, contents);
}

await browser.close();
if (failed) process.exitCode = 1;
