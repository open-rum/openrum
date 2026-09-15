import { z } from "zod";
import { createOpenRUMDSNForInstance, parseOpenRUMDSN } from "@openrum/protocol/dsn";
import { csrfHeaders } from "@/lib/auth/session";
import { requestJSON } from "./client";

const presetSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
});

// The scenario is passed through as an opaque object: the server owns its
// schema and validates it, so mirroring every field here would only create a
// second definition to keep in step.
const scenarioSchema = z.looseObject({
  seed: z.number(),
  environment: z.string(),
  baseUrl: z.string(),
  sessions: z.number(),
});

const presetsResponseSchema = z.object({
  presets: z.array(presetSchema),
  scenario: scenarioSchema,
});

const resultSchema = z.object({
  summary: z.object({
    sessions: z.number(),
    envelopes: z.number(),
    events: z.number(),
    byType: z.record(z.string(), z.number()),
  }),
  accepted: z.number(),
  rejected: z.number(),
  envelopes: z.number(),
  failed: z.number(),
  elapsedMs: z.number(),
  message: z.string(),
});

export type DevDataPreset = z.infer<typeof presetSchema>;
export type DevDataScenario = z.infer<typeof scenarioSchema>;
export type DevDataPresetsResponse = z.infer<typeof presetsResponseSchema>;
export type DevDataResult = z.infer<typeof resultSchema>;

export type DevDataRequest = {
  dsn: string;
  preset?: string;
  sessions?: number;
  minutes?: number;
  seed?: number;
  scenario?: DevDataScenario;
};

export function getDevDataPresets(
  projectId: string,
  preset: string,
  minutes: number,
): Promise<DevDataPresetsResponse> {
  const query = new URLSearchParams({ preset, minutes: String(minutes) });
  return requestJSON(
    presetsResponseSchema,
    `/api/v1/projects/${projectId}/dev-data/presets?${query.toString()}`,
  );
}

export function generateDevData(projectId: string, body: DevDataRequest): Promise<DevDataResult> {
  const { writeKey } = parseOpenRUMDSN(body.dsn);
  return requestJSON(resultSchema, `/api/v1/projects/${projectId}/dev-data`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ ...body, dsn: undefined, writeKey }),
  });
}

const dsnStorageKey = "openrum.devdata.dsn";

// Keep the DSN locally to spare re-entry on every development-data run.
export function readStoredDSN(): string {
  try {
    const current = window.localStorage.getItem(dsnStorageKey);
    if (current) return current;
    const legacyKey = window.localStorage.getItem("openrum.devdata.writeKey");
    if (!legacyKey) return "";
    const dsn = createOpenRUMDSNForInstance(window.location.origin, legacyKey);
    window.localStorage.setItem(dsnStorageKey, dsn);
    window.localStorage.removeItem("openrum.devdata.writeKey");
    return dsn;
  } catch {
    return "";
  }
}

export function storeDSN(value: string): void {
  try {
    if (value) window.localStorage.setItem(dsnStorageKey, value);
    else window.localStorage.removeItem(dsnStorageKey);
  } catch {
    // A blocked storage API only costs convenience, so it is not worth
    // surfacing as an error.
  }
}

export const devDataWindows = [
  { label: "最近 1 小时", minutes: 60 },
  { label: "最近 6 小时", minutes: 360 },
  { label: "最近 24 小时", minutes: 1_440 },
  { label: "最近 7 天", minutes: 10_080 },
  { label: "最近 14 天", minutes: 20_160 },
] as const;
