import { existsSync, readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

const configPath = "packages/browser-sdk/size-limit.json";
const config = JSON.parse(readFileSync(configPath, "utf8"));

if (!Number.isInteger(config.maxBytes) || config.maxBytes <= 0) {
  throw new Error("browser SDK maxBytes must be a positive integer");
}

const packageExists = existsSync("packages/browser-sdk/package.json");
const artifactExists = existsSync(config.artifact);
if (packageExists && !artifactExists) {
  throw new Error(`browser SDK package exists but ${config.artifact} was not built`);
}
if (!artifactExists) {
  console.log(`Browser SDK placeholder budget validated: ${config.maxBytes} bytes`);
  process.exit(0);
}

const bytes = gzipSync(readFileSync(config.artifact), { level: 9 }).byteLength;
if (bytes > config.maxBytes) {
  throw new Error(`browser SDK gzip is ${bytes} bytes; budget is ${config.maxBytes} bytes`);
}
console.log(`Browser SDK gzip size: ${bytes}/${config.maxBytes} bytes`);
