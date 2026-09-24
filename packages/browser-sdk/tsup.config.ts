import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "iife"],
  globalName: "OpenRUM",
  target: "es2022",
  dts: true,
  minify: true,
  splitting: false,
  clean: true,
  noExternal: ["web-vitals"],
  outExtension({ format }) {
    return { js: format === "iife" ? ".iife.js" : ".js" };
  },
});
