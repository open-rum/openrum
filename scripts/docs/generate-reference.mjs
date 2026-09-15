import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const outputDirectory = join(root, "apps/site/src/content/docs/docs/reference");
const chineseOutputDirectory = join(root, "apps/site/src/content/docs/zh/docs/reference");
const check = process.argv.includes("--check");

await mkdir(outputDirectory, { recursive: true });
await mkdir(chineseOutputDirectory, { recursive: true });

const configSource = await readFile(join(root, "internal/config/config.go"), "utf8");
const variableNames = [
  ...new Set([...configSource.matchAll(/values\("([A-Z][A-Z0-9_]+)"\)/g)].map((match) => match[1])),
].sort();
const descriptions = {
  APP_ENV: "Runtime environment: development, test, staging or production.",
  PUBLIC_BASE_URL: "Canonical Console origin; HTTPS is required in production.",
  POSTGRES_DSN: "Control-plane PostgreSQL connection string.",
  CLICKHOUSE_DSN: "Event and aggregate ClickHouse connection string.",
  KAFKA_BROKERS: "Comma-separated Kafka brokers.",
  REDIS_ADDR: "Redis address for quotas, status and caches.",
  GEO_COUNTRY_HEADER:
    "Header carrying the visitor country, injected by the edge proxy (for example CF-IPCountry). Unset disables country resolution and stores ZZ.",
  GEO_TRUSTED_PROXIES:
    "Comma-separated CIDRs or addresses whose forwarded country header is believed. Required when GEO_COUNTRY_HEADER is set; never widen this to the public internet.",
  INGEST_TRUSTED_PROXIES:
    "Comma-separated CIDRs or addresses of the proxies that terminate ingest traffic. Unset keeps the rate-limit identity on the socket peer, so every caller behind a shared proxy counts as one. Setting it reads X-Forwarded-For from those peers only; never widen this to the public internet, because whoever matches can choose the identity they are limited on.",
  OBJECT_STORAGE_PROVIDER: "Optional oss or s3 provider.",
  OPENRUM_ALLOW_MANAGED_SECRETS: "Explicit opt-in for console-managed encrypted credentials.",
  OPENRUM_MASTER_KEY: "Base64 for exactly 32 external key bytes; never stored in PostgreSQL.",
};
// Translated alongside the English text so that a Chinese reader looking up a variable is
// not dropped into English. Anything missing here falls back to the generic sentence.
const chineseDescriptions = {
  APP_ENV: "运行环境：development、test、staging 或 production。",
  PUBLIC_BASE_URL: "Console 的规范 origin；生产环境必须使用 HTTPS。",
  POSTGRES_DSN: "控制面 PostgreSQL 连接串。",
  CLICKHOUSE_DSN: "Event 与聚合结果的 ClickHouse 连接串。",
  KAFKA_BROKERS: "以逗号分隔的 Kafka broker 列表。",
  REDIS_ADDR: "用于配额、状态和缓存的 Redis 地址。",
  GEO_COUNTRY_HEADER:
    "由边缘代理注入、携带访客国家的 header（例如 CF-IPCountry）。留空则关闭国家解析并存为 ZZ。",
  GEO_TRUSTED_PROXIES:
    "以逗号分隔的 CIDR 或地址，只有它们转发的国家 header 才被信任。设置了 GEO_COUNTRY_HEADER 时必填；切勿放宽到公网。",
  INGEST_TRUSTED_PROXIES:
    "以逗号分隔的 CIDR 或地址，指明终结上报流量的代理。留空则限流身份继续绑定 socket 对端，此时共享代理后面的所有调用方会被算作同一个。填写后只读取来自这些对端的 X-Forwarded-For；切勿放宽到公网，因为匹配到的一方就能自行决定被限流的身份。",
  OBJECT_STORAGE_PROVIDER: "可选的 oss 或 s3 provider。",
  OPENRUM_ALLOW_MANAGED_SECRETS: "显式开启由 Console 托管的加密凭据。",
  OPENRUM_MASTER_KEY: "恰好 32 字节外部密钥的 Base64 值；绝不存入 PostgreSQL。",
};

function configurationPage({ title, description, generatedFrom, columns, fallback, notes }) {
  const rows = variableNames
    .map((name) => `| \`${name}\` | ${notes[name] || fallback} |`)
    .join("\n");
  return `---
title: ${title}
description: ${description}
appliesTo: Alpha / main
---

<!-- GENERATED: scripts/docs/generate-reference.mjs -->

${generatedFrom}

| ${columns.join(" | ")} |
| --- | --- |
${rows}
`;
}

const configuration = configurationPage({
  title: "Configuration reference",
  description: "Generated environment-variable reference for OpenRUM services.",
  generatedFrom: "Generated from `internal/config/config.go`; do not edit by hand.",
  columns: ["Variable", "Purpose"],
  fallback: "Optional service or feature configuration; see source validation for constraints.",
  notes: descriptions,
});
const chineseConfiguration = configurationPage({
  title: "配置参考",
  description: "OpenRUM 各服务的环境变量参考，自动生成。",
  generatedFrom: "由 `internal/config/config.go` 生成，请勿手工编辑。",
  columns: ["变量", "用途"],
  fallback: "可选的服务或特性配置；约束条件见源码中的校验逻辑。",
  notes: chineseDescriptions,
});

const schema = JSON.parse(
  await readFile(join(root, "packages/protocol/schema/envelope-v1.json"), "utf8"),
);
const eventRefs = schema.properties.events.items.oneOf.map((item) => item.$ref.split("/").at(-1));
const eventRows = eventRefs
  .map((name) => {
    const definition = schema.$defs[name];
    const type = definition?.properties?.type?.const ?? name;
    const required = (definition?.required ?? []).map((value) => `\`${value}\``).join(", ");
    return `| \`${type}\` | ${required || "—"} |`;
  })
  .join("\n");
const eventSchema = `---
title: Event schema
description: Generated summary of the canonical OpenRUM Envelope V1 schema.
appliesTo: schema ${schema.properties.schema_version.const}
---

<!-- GENERATED: scripts/docs/generate-reference.mjs -->

Generated from \`packages/protocol/schema/envelope-v1.json\`; do not edit by hand.

An Envelope requires ${schema.required.map((value) => `\`${value}\``).join(", ")}. It contains between ${schema.properties.events.minItems} and ${schema.properties.events.maxItems} Events.

| Event type | Event-specific required fields |
| --- | --- |
${eventRows}

The canonical JSON Schema defines all bounds and formats. Generated Go validation is verified by \`pnpm run protocol:check\`.
`;

const helmSource = await readFile(join(root, "deploy/helm/openrum/values.yaml"), "utf8");
const helmValues = `---
title: Helm values reference
description: Generated source-of-truth values for the OpenRUM Helm chart.
appliesTo: Alpha / main
---

<!-- GENERATED: scripts/docs/generate-reference.mjs -->

Generated verbatim from \`deploy/helm/openrum/values.yaml\`; do not edit by hand.

Use a separate values file for your environment and keep credentials in the configured existing Kubernetes Secret.

\`\`\`yaml
${helmSource.trimEnd()}
\`\`\`
`;

// Browser SDK options. Generated so that adding a field to `ClientOptions` without
// documenting it fails `pnpm docs:check` rather than shipping an undocumented option.
const sdkSource = await readFile(join(root, "packages/browser-sdk/src/client.ts"), "utf8");
const samplingSource = await readFile(join(root, "packages/browser-sdk/src/sampling.ts"), "utf8");
const senderSource = await readFile(
  join(root, "packages/browser-sdk/src/transport/sender.ts"),
  "utf8",
);
const sdkPackage = JSON.parse(
  await readFile(join(root, "packages/browser-sdk/package.json"), "utf8"),
);

const samplingDefaults = Object.fromEntries(
  [...samplingSource.matchAll(/(\w+SampleRate): ([\d.]+),/g)].map((match) => [match[1], match[2]]),
);
const flushDefaultMs = Number(
  senderSource.match(/DEFAULT_FLUSH_INTERVAL_MS = ([\d_]+)/)?.[1].replaceAll("_", ""),
);

// Defaults and notes the type declaration cannot express. Every option must appear
// here; the generator fails otherwise.
const sdkOptionNotes = {
  dsn: [
    "—",
    "Public Project connection string containing the Ingest URL and write-only client key.",
  ],
  environment: ['`"production"`', "Separates Events from staging and production."],
  release: ["unset", "Required for mapped stack frames. Must match the uploaded Release."],
  dist: ["unset", "Distinguishes builds that share one Release."],
  eventSampleRate: [
    `\`${samplingDefaults.eventSampleRate}\``,
    "Page Views, interactions, Custom Events and opted-in Logs.",
  ],
  apiSampleRate: [`\`${samplingDefaults.apiSampleRate}\``, "fetch and XHR timing."],
  errorSampleRate: [`\`${samplingDefaults.errorSampleRate}\``, "Errors and unhandled rejections."],
  captureClicks: ["`true`", "Privacy-safe descriptions of interactive elements."],
  enableLogs: [
    "ignored",
    "Compatibility-only; logger calls and captureConsole are independently explicit.",
  ],
  captureConsole: ["unset", "Opt-in console methods: debug, log, info, warn, error."],
  beforeSendLog: [
    "unset",
    "Transforms a log or returns null to drop it; final privacy scrubbing still applies.",
  ],
  flushIntervalMs: [`\`${flushDefaultMs}\``, "Also flushed on `pagehide` and on reconnect."],
  beaconEndpoint: ["unset", "Pre-authenticated `sendBeacon` URL. Never gets the DSN credential."],
  configEndpoint: ["DSN origin", "Remote sampling from `/api/v1/sdk/config`. `false` disables it."],
  integrations: ["all of the above", "Replaces the default set rather than adding to it."],
};

const sdkOptions = [];
let pendingDescription;
for (const line of sdkSource
  .match(/export interface ClientOptions \{([\s\S]*?)\n\}/)?.[1]
  .split("\n") ?? []) {
  const documented = line.match(/^\s*\/\*\* (.+?) \*\/$/);
  if (documented) {
    pendingDescription = documented[1];
    continue;
  }
  const member = line.match(/^\s*(\w+)(\?)?:\s*(.+);$/);
  pendingDescription = undefined;
  if (!member) continue;
  sdkOptions.push({ name: member[1], required: !member[2], type: member[3] });
}
if (sdkOptions.length === 0) {
  console.error("Could not read ClientOptions from packages/browser-sdk/src/client.ts.");
  process.exitCode = 1;
}
const undocumented = sdkOptions.filter((option) => !sdkOptionNotes[option.name]);
if (undocumented.length > 0) {
  console.error(
    `ClientOptions gained undocumented options: ${undocumented.map((option) => option.name).join(", ")}. Describe them in scripts/docs/generate-reference.mjs.`,
  );
  process.exitCode = 1;
}
const sdkRows = sdkOptions
  .map((option) => {
    const [fallback, note] = sdkOptionNotes[option.name] ?? ["—", ""];
    // Union types carry a pipe, which would otherwise end the table cell.
    const type = option.type.replaceAll("|", "\\|");
    return `| \`${option.name}\` | \`${type}\` | ${option.required ? "required" : fallback} | ${note} |`;
  })
  .join("\n");
const sdkOptionsReference = `---
title: SDK options
description: Generated reference for every @openrum/browser initialization option.
appliesTo: "${sdkPackage.name} ${sdkPackage.version}"
---

<!-- GENERATED: scripts/docs/generate-reference.mjs -->

Generated from \`packages/browser-sdk/src/client.ts\`; do not edit by hand. Pass these to
\`init()\` — see [Browser SDK](/docs/sdk/browser/).

| Option | Type | Default | Notes |
| --- | --- | --- | --- |
${sdkRows}

Sample rates outside 0 to 1 are ignored and the built-in default applies instead, so a typo
cannot silently stop collection. The three rates are decided independently but
deterministically per Session, so a Session is never half-recorded.

\`configEndpoint\` responses are cached, and an invalid one leaves the locally configured
rates in place. Passing \`integrations\` replaces the defaults, so a list without the page
integration turns off automatic Page Views.
`;

await emit("configuration.md", configuration);
await emit("event-schema.md", eventSchema);
await emit("helm-values.md", helmValues);
await emit("sdk-options.md", sdkOptionsReference);
await emit("configuration.md", chineseConfiguration, chineseOutputDirectory);

async function emit(name, contents, directory = outputDirectory) {
  const target = join(directory, name);
  if (!check) {
    await writeFile(target, contents);
    return;
  }
  const existing = await readFile(target, "utf8").catch(() => "");
  if (existing !== contents) {
    console.error(`Generated reference is out of date: ${name}. Run pnpm docs:generate.`);
    process.exitCode = 1;
  }
}
