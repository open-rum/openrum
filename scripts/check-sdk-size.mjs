import { existsSync, readFileSync, statSync } from "node:fs";

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

const bytes = statSync(config.artifact).size;
if (bytes > config.maxBytes) {
  throw new Error(`browser SDK is ${bytes} bytes; budget is ${config.maxBytes} bytes`);
}
console.log(`Browser SDK size: ${bytes}/${config.maxBytes} bytes`);
