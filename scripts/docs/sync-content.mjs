import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const docsRoot = join(root, "apps/site/src/content/docs/docs");
const repositoryOutput = join(docsRoot, "repository");

/** @type {Array<[string, string, string, string]>} */
const publicGuides = [
  [
    "operations/kafka",
    "Kafka",
    "Operate the ingestion buffer when brokers, lag or acknowledgement fail.",
    "docs/operations/kafka.md",
  ],
  [
    "operations/postgres",
    "PostgreSQL",
    "Operate the control-plane database for users, projects and workflow state.",
    "docs/operations/postgres.md",
  ],
  [
    "operations/redis",
    "Redis",
    "Operate quotas, short-lived state and rate-limit dependencies.",
    "docs/operations/redis.md",
  ],
  [
    "operations/clickhouse",
    "ClickHouse",
    "Operate event storage, aggregates and query freshness.",
    "docs/operations/clickhouse.md",
  ],
  [
    "operations/object-storage",
    "Object storage",
    "Operate optional OSS or S3-compatible storage for Source Map Artifacts.",
    "docs/operations/oss.md",
  ],
  [
    "operations/upgrades",
    "Upgrades",
    "Upgrade OpenRUM services, schema and dependencies safely.",
    "docs/operations/upgrades.md",
  ],
  [
    "operations/backup-restore",
    "Backup and restore",
    "Protect control-plane state, events and optional Source Map Artifacts.",
    "docs/operations/backup-restore.md",
  ],
  [
    "security/threat-model",
    "Threat model",
    "Trust boundaries, threats, controls and residual risks for a public Instance.",
    "docs/security/threat-model.md",
  ],
  [
    "contributing/local-development",
    "Local development",
    "Work on OpenRUM services, SDK, console and public site.",
    "docs/local-development.md",
  ],
  [
    "contributing/system-administration",
    "System administration",
    "Instance-level configuration, data lifecycle, secrets and operator boundaries.",
    "docs/system-administration.md",
  ],
  [
    "getting-started/demo-data",
    "Deterministic Demo data",
    "Reproduce the local ecommerce investigation dataset safely.",
    "docs/demo-data.md",
  ],
];

function stripLeadingHeading(body) {
  return body.replace(/^# .+\n/, "");
}

await rm(repositoryOutput, { recursive: true, force: true });

for (const [route, title, description, source] of publicGuides) {
  const target = join(docsRoot, `${route}.md`);
  await mkdir(dirname(target), { recursive: true });
  const body = await readFile(join(root, source), "utf8");
  await writeFile(
    target,
    `---\ntitle: ${title}\ndescription: ${description}\n---\n\n> Canonical source: \`${source}\`. Edit the repository file; this page is generated during \`pnpm site:build\`.\n\n${stripLeadingHeading(body)}\n`,
  );
}
