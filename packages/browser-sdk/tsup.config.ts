import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "iife"],
  globalName: "OpenRUM",
  target: "es2022",
  // tsconfig maps @openrum/protocol to its source, so the declarations inline its types too.
  dts: true,
  minify: true,
  splitting: false,
  clean: true,
  // The protocol package is private and never published, so it ships inside the bundle.
  noExternal: ["web-vitals", "@openrum/protocol"],
  outExtension({ format }) {
    return { js: format === "iife" ? ".iife.js" : ".js" };
  },
});
