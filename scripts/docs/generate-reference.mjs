import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const outputDirectory = join(root, "apps/site/src/content/docs/docs/reference");
const check = process.argv.includes("--check");

await mkdir(outputDirectory, { recursive: true });

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
  OBJECT_STORAGE_PROVIDER: "Optional oss or s3 provider.",
  OPENRUM_ALLOW_MANAGED_SECRETS: "Explicit opt-in for console-managed encrypted credentials.",
  OPENRUM_MASTER_KEY: "Base64 for exactly 32 external key bytes; never stored in PostgreSQL.",
};
const configRows = variableNames
  .map(
    (name) =>
      `| \`${name}\` | ${descriptions[name] || "Optional service or feature configuration; see source validation for constraints."} |`,
  )
  .join("\n");
const configuration = `---
title: Configuration reference
description: Generated environment-variable reference for OpenRUM services.
---

<!-- GENERATED: scripts/docs/generate-reference.mjs -->

**Applies to:** Alpha / main. Generated from \`internal/config/config.go\`; do not edit by hand.

| Variable | Purpose |
| --- | --- |
${configRows}
`;

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
---

<!-- GENERATED: scripts/docs/generate-reference.mjs -->

**Applies to:** schema \`${schema.properties.schema_version.const}\`. Generated from \`packages/protocol/schema/envelope-v1.json\`; do not edit by hand.

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
---

<!-- GENERATED: scripts/docs/generate-reference.mjs -->

**Applies to:** Alpha / main. Generated verbatim from \`deploy/helm/openrum/values.yaml\`; do not edit by hand.

Use a separate values file for your environment and keep credentials in the configured existing Kubernetes Secret.

\`\`\`yaml
${helmSource.trimEnd()}
\`\`\`
`;

await emit("configuration.md", configuration);
await emit("event-schema.md", eventSchema);
await emit("helm-values.md", helmValues);

async function emit(name, contents) {
  const target = join(outputDirectory, name);
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
