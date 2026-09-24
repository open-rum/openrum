// Run the two constant-arrival workloads together; retain raw evidence privately.
// Usage: node tests/load/run-local.mjs <fixture-directory> <run-id> <EPS> <QPS> <duration>
import { spawn, execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { cpus, totalmem, platform, release } from "node:os";
import { resolve } from "node:path";

const [fixture, runID, eps = "2000", qps = "10", duration = "60s"] = process.argv.slice(2);
if (!fixture || !/^[a-z0-9-]+$/.test(runID || ""))
  throw new Error("Fixture directory and alphanumeric run ID required");
if (
  ![eps, qps].every((value) => Number.isInteger(Number(value)) && Number(value) > 0) ||
  Number(eps) % 100 !== 0 ||
  !/^[1-9]\d*(s|m)$/.test(duration)
)
  throw new Error(
    "EPS must be a positive multiple of 100; QPS positive integer; duration in seconds/minutes",
  );
const credentials = resolve(fixture, "credentials.env");
const project = readFileSync(credentials, "utf8").match(/^OPENRUM_PROJECT_ID=(.+)$/m)[1];
if (!/^[0-9a-f-]{36}$/.test(project)) throw new Error("Invalid fixture Project ID");
const output = resolve(fixture, runID);
if (existsSync(output)) throw new Error("Run IDs are immutable; choose a new ID");
mkdirSync(output, { recursive: true, mode: 0o700 });
const hardware = {
  cpu: cpus()[0].model,
  logicalCores: cpus().length,
  memoryBytes: totalmem(),
  platform: platform(),
  kernel: release(),
  docker: JSON.parse(
    execFileSync(
      "docker",
      [
        "info",
        "--format",
        '{"cpus":{{.NCPU}},"memoryBytes":{{.MemTotal}},"version":"{{.ServerVersion}}"}',
      ],
      { encoding: "utf8" },
    ),
  ),
};
const projectRowCount = () =>
  Number(
    execFileSync(
      "docker",
      [
        "exec",
        "openrum-clickhouse-1",
        "clickhouse-client",
        "--query",
        `SELECT count() FROM openrum.rum_events WHERE project_id='${project}'`,
      ],
      { encoding: "utf8" },
    ).trim(),
  );
const startingProjectRows = projectRowCount();
const startedAt = new Date().toISOString();
const resources = [];
const pipeline = [];
let sampling = false;
const timer = setInterval(() => {
  if (sampling) return;
  sampling = true;
  const child = spawn("docker", ["stats", "--no-stream", "--format", "{{json .}}"]);
  let text = "";
  child.stdout.on("data", (b) => (text += b));
  child.on("close", () => {
    resources.push({
      at: new Date().toISOString(),
      containers: text
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line)),
    });
    sampling = false;
  });
  const probe = spawn("docker", [
    "exec",
    process.env.CONSUMER_CONTAINER || "openrum-consumer-1",
    "wget",
    "-qO-",
    "http://localhost:8082/metrics",
  ]);
  let metrics = "";
  probe.stdout.on("data", (b) => (metrics += b));
  probe.on("close", (code) =>
    pipeline.push({
      at: new Date().toISOString(),
      code,
      metrics: metrics
        .split("\n")
        .filter(
          (line) =>
            !line.startsWith("#") &&
            /kafka_lag_seconds |clickhouse_batch_rows_(sum|count) |retries_total /.test(line),
        )
        .join("\n"),
    }),
  );
}, 10000);
const workload = (kind, script, rateName, rate) =>
  new Promise((resolveRun) => {
    const args = [
      "run",
      "--rm",
      "--network",
      "openrum_default",
      "--env-file",
      credentials,
      "-e",
      `RUN_ID=${runID}`,
      "-e",
      `${rateName}=${rate}`,
      "-e",
      `DURATION=${duration}`,
      "-e",
      "PREALLOCATED_VUS=32",
      "-e",
      "MAX_VUS=256",
      "-e",
      `WORKLOAD=${process.env.WORKLOAD || "custom"}`,
      ...(process.env.OPENRUM_BENCHMARK_API_URL
        ? ["-e", `OPENRUM_API_URL=${process.env.OPENRUM_BENCHMARK_API_URL}`]
        : []),
      ...(process.env.OPENRUM_BENCHMARK_INGEST_URL
        ? ["-e", `OPENRUM_INGEST_URL=${process.env.OPENRUM_BENCHMARK_INGEST_URL}`]
        : []),
      "-v",
      `${resolve("tests/load")}:/scripts:ro`,
      "-v",
      `${output}:/results`,
      "grafana/k6:latest",
      "run",
      "--quiet",
      "--summary-trend-stats=avg,med,p(95),p(99),max",
      `--summary-export=/results/${kind}.json`,
      `/scripts/${script}`,
    ];
    const child = spawn("docker", args);
    let log = "";
    child.stdout.on("data", (b) => (log += b));
    child.stderr.on("data", (b) => (log += b));
    child.on("close", (code) => {
      writeFileSync(resolve(output, `${kind}.log`), log);
      resolveRun({ kind, code });
    });
  });
const statuses = await Promise.all([
  workload("ingest", "ingest.js", "EVENT_RATE", eps),
  workload("query", "query-production.js", "QUERY_RATE", qps),
]);
clearInterval(timer);
const loadEndedAt = new Date().toISOString();
const query = `SELECT count() AS stored, uniqExact(event_id) AS unique, max(received_at) AS latest FROM openrum.rum_events WHERE project_id='${project}' AND attributes['tag.load_run_id']='${runID}' FORMAT JSONEachRow`;
let reconciliation;
const ingest = JSON.parse(readFileSync(resolve(output, "ingest.json"), "utf8"));
const accepted = ingest.metrics.openrum_accepted_events?.count || 0;
const checkpoints = [];
for (let index = 0; index < 61; index++) {
  reconciliation = JSON.parse(
    execFileSync(
      "docker",
      ["exec", "openrum-clickhouse-1", "clickhouse-client", "--query", query],
      { encoding: "utf8" },
    ),
  );
  checkpoints.push({ at: new Date().toISOString(), ...reconciliation });
  if (Number(reconciliation.stored) >= accepted) break;
  await new Promise((r) => setTimeout(r, 10000));
}
const passed =
  statuses.every((s) => s.code === 0) &&
  accepted > 0 &&
  Number(reconciliation.stored) === accepted &&
  Number(reconciliation.unique) === accepted;
const report = {
  runID,
  project,
  hardware,
  startedAt,
  loadEndedAt,
  finishedAt: new Date().toISOString(),
  startingProjectRows,
  endingProjectRows: projectRowCount(),
  eps: Number(eps),
  qps: Number(qps),
  duration,
  workload: process.env.WORKLOAD || "custom",
  passed,
  statuses,
  accepted,
  reconciliation,
  checkpoints,
  resources,
  pipeline,
};
writeFileSync(resolve(output, "run.json"), JSON.stringify(report, null, 2));
console.log(
  JSON.stringify(
    {
      ...report,
      resources: report.resources.length,
      checkpoints: report.checkpoints.length,
      pipeline: report.pipeline.length,
    },
    null,
    2,
  ),
);
process.exitCode = passed ? 0 : 1;
