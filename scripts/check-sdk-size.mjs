import { existsSync, readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { gzipSync } from "node:zlib";

const configPath = "packages/browser-sdk/size-limit.json";
const config = JSON.parse(readFileSync(configPath, "utf8"));

if (!Number.isInteger(config.maxBytes) || config.maxBytes <= 0) {
  throw new Error("browser SDK maxBytes must be a positive integer");
}

const packageExists = existsSync("packages/browser-sdk/package.json");
const artifacts = [config.artifact, config.iifeArtifact];
if (artifacts.some((artifact) => typeof artifact !== "string" || !artifact)) {
  throw new Error("browser SDK artifact paths must be non-empty strings");
}
const missing = artifacts.filter((artifact) => !existsSync(artifact));
if (packageExists && missing.length > 0) {
  throw new Error(`browser SDK package exists but ${missing.join(", ")} was not built`);
}
if (missing.length > 0) {
  console.log(`Browser SDK placeholder budget validated: ${config.maxBytes} bytes`);
  process.exit(0);
}

for (const artifact of artifacts) {
  const bytes = gzipSync(readFileSync(artifact), { level: 9 }).byteLength;
  if (bytes > config.maxBytes) {
    throw new Error(`${artifact} gzip is ${bytes} bytes; budget is ${config.maxBytes} bytes`);
  }
  console.log(`${artifact} gzip size: ${bytes}/${config.maxBytes} bytes`);
}

const iifeSource = readFileSync(config.iifeArtifact, "utf8");
const sandbox = {};
runInNewContext(iifeSource, sandbox);
for (const method of ["init", "captureEvent", "setUser", "setTag", "addBreadcrumb", "close"]) {
  if (typeof sandbox.OpenRUM?.[method] !== "function") {
    throw new Error(`${config.iifeArtifact} does not expose OpenRUM.${method}()`);
  }
}

const packageVersion = JSON.parse(
  readFileSync("packages/browser-sdk/package.json", "utf8"),
).version;
const protocolSource = readFileSync("packages/protocol/src/dsn.ts", "utf8");
const handlerSource = readFileSync("services/api/internal/handlers/browser_sdk.go", "utf8");
if (!protocolSource.includes(`OPENRUM_BROWSER_SDK_VERSION = "${packageVersion}"`)) {
  throw new Error("Browser SDK package version and protocol CDN path have drifted");
}
if (!new RegExp(`BrowserSDKVersion\\s*=\\s*"${packageVersion}"`).test(handlerSource)) {
  throw new Error("Browser SDK package version and API CDN path have drifted");
}
const publicPath = `/sdk/browser/${packageVersion}/openrum.min.js`;
if (
  !protocolSource.includes("/sdk/browser/${OPENRUM_BROWSER_SDK_VERSION}/openrum.min.js") ||
  !new RegExp(`BrowserSDKPublicPath\\s*=\\s*"${publicPath.replaceAll("/", "\\/")}"`).test(
    handlerSource,
  )
) {
  throw new Error("Browser SDK protocol and served public path have drifted");
}
console.log(`Browser SDK IIFE global and versioned path validated: ${packageVersion}`);
