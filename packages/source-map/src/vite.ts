import { resolve } from "node:path";
import type { Plugin } from "vite";
import {
  uploadSourceMaps,
  validateOptions,
  type OpenRUMLogger,
  type OpenRUMSourceMapOptions,
} from "./core.ts";

/**
 * Uploads the build's hidden Source Maps to an OpenRUM Release once Vite has written its
 * output, then removes the maps and their `sourceMappingURL` comments from the build.
 */
export function openRUMSourceMaps(options: OpenRUMSourceMapOptions): Plugin {
  validateOptions(options);
  let outDir: string | undefined;
  let logger: OpenRUMLogger | undefined;
  return {
    name: "openrum-sourcemaps",
    apply: "build",
    enforce: "post",
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
      logger = config.logger;
    },
    async closeBundle() {
      await uploadSourceMaps({
        ...options,
        outDir: options.outDir ?? outDir,
        logger: options.logger ?? logger,
      });
    },
  };
}

export default openRUMSourceMaps;
