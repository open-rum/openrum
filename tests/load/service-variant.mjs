// Start an isolated current-source API/Ingest on the local Compose network.
// Does not replace the developer's API/Ingest. No ports are exposed publicly.
import { execFileSync } from "node:child_process";
import { accessSync } from "node:fs";
import { resolve } from "node:path";
const [service, binary, queryThreads] = process.argv.slice(2);
if (!["api", "ingest"].includes(service) || !binary)
  throw new Error("Usage: service-variant.mjs api|ingest <linux-arm64-binary>");
accessSync(resolve(binary));
const docker = (args, options = {}) =>
  execFileSync("docker", args, { encoding: "utf8", ...options });
const info = JSON.parse(docker(["inspect", "openrum-benchmark-consumer"]))[0];
const env = {
  ...process.env,
  ...Object.fromEntries(
    info.Config.Env.map((value) => {
      const index = value.indexOf("=");
      return [value.slice(0, index), value.slice(index + 1)];
    }),
  ),
};
if (queryThreads !== undefined) {
  if (service !== "api" || !/^(?:[1-9]|[1-5][0-9]|6[0-4])$/.test(queryThreads))
    throw new Error("Optional API query threads must be 1..64");
  const dsn = new URL(env.CLICKHOUSE_DSN);
  dsn.searchParams.set("max_threads", queryThreads);
  env.CLICKHOUSE_DSN = dsn.toString();
}
const name = `openrum-benchmark-${service}`;
docker(
  [
    "run",
    "-d",
    "--pull",
    "never",
    "--name",
    name,
    "--network",
    "openrum_default",
    ...info.Config.Env.map((value) => value.split("=")[0]).flatMap((key) => ["-e", key]),
    "-v",
    `${resolve(binary)}:/benchmark/service:ro`,
    info.Config.Image,
    "/benchmark/service",
  ],
  { env },
);
const port = service === "api" ? 8080 : 8081;
let ready = false;
for (let attempt = 0; attempt < 30; attempt++) {
  try {
    docker(["exec", name, "wget", "-qO-", `http://localhost:${port}/health/ready`], {
      stdio: "pipe",
    });
    ready = true;
    break;
  } catch {
    await new Promise((r) => setTimeout(r, 1000));
  }
}
if (!ready) throw new Error(`Benchmark ${service} did not become ready; inspect and stop ${name}`);
console.log(`Ready: http://${name}:${port}`);
