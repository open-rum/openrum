// Temporarily run a freshly built Consumer against the local Compose stack.
// Restore the original container after testing. Never remove volumes or data.
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { accessSync } from "node:fs";
const [mode, binary, count = "4", flush = "10ms"] = process.argv.slice(2);
const docker = (args, options = {}) =>
  execFileSync("docker", args, { encoding: "utf8", ...options });
const original = "openrum-consumer-1",
  variant = "openrum-benchmark-consumer";
if (mode === "restore") {
  docker(["stop", "--time", "30", variant]);
  docker(["rm", variant]); // Only the disposable test container, no volumes.
  docker(["start", original]);
} else if (mode === "start") {
  if (!/^(?:[1-9]|[1-5][0-9]|6[0-4])$/.test(count)) throw new Error("Worker count must be 1..64");
  accessSync(resolve(binary));
  const info = JSON.parse(docker(["inspect", original]))[0];
  if (docker(["ps", "-a", "--format", "{{.Names}}"]).split("\n").includes(variant))
    throw new Error("Restore existing variant first");
  const overrides = {
    OPENRUM_CONSUMER_WORKERS: count,
    OPENRUM_CONSUMER_FLUSH_INTERVAL: flush,
    OPENRUM_STORAGE_PRESSURE_GUARD_ENABLED: "true",
    OPENRUM_STORAGE_WARNING_FREE_RATIO: "0.15",
    OPENRUM_STORAGE_CRITICAL_FREE_RATIO: "0.10",
    OPENRUM_STORAGE_HARD_STOP_FREE_RATIO: "0.05",
    OPENRUM_STORAGE_RECOVERY_FREE_RATIO: "0.10",
  };
  const env = {
    ...process.env,
    ...Object.fromEntries(
      info.Config.Env.map((value) => {
        const index = value.indexOf("=");
        return [value.slice(0, index), value.slice(index + 1)];
      }),
    ),
    ...overrides,
  };
  docker(["stop", "--time", "30", original]);
  try {
    docker(
      [
        "run",
        "-d",
        "--pull",
        "never",
        "--name",
        variant,
        "--network",
        "openrum_default",
        ...[
          ...new Set([
            ...info.Config.Env.map((value) => value.split("=")[0]),
            ...Object.keys(overrides),
          ]),
        ].flatMap((key) => ["-e", key]),
        "-v",
        `${resolve(binary)}:/benchmark/consumer:ro`,
        info.Config.Image,
        "/benchmark/consumer",
      ],
      { env },
    );
    // A successful docker run only means the container was created, not that
    // the binary loaded its configuration or connected successfully.
    await new Promise((r) => setTimeout(r, 2000));
    if (docker(["inspect", "--format", "{{.State.Running}}", variant]).trim() !== "true")
      throw new Error("Benchmark Consumer failed startup");
  } catch (error) {
    try {
      docker(["stop", "--time", "30", variant]);
      docker(["rm", variant]);
    } catch {
      /* Creation itself may have failed. */
    }
    docker(["start", original]);
    throw error;
  }
  console.log(
    `Temporary Consumer: ${count} workers, ${flush} flush. Restore with: node tests/load/consumer-variant.mjs restore`,
  );
} else
  throw new Error("Usage: consumer-variant.mjs start <linux-arm64-binary> [workers] | restore");
