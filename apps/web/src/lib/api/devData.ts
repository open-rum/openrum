import { z } from "zod";
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
  writeKey: string;
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
  return requestJSON(resultSchema, `/api/v1/projects/${projectId}/dev-data`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(body),
  });
}

const writeKeyStorageKey = "openrum.devdata.writeKey";

// The write key lives in the browser because project keys are stored hashed and
// the server cannot supply one. Keeping it here spares re-entry on every run;
// it is only ever a development project's key.
export function readStoredWriteKey(): string {
  try {
    return window.localStorage.getItem(writeKeyStorageKey) ?? "";
  } catch {
    return "";
  }
}

export function storeWriteKey(value: string): void {
  try {
    if (value) window.localStorage.setItem(writeKeyStorageKey, value);
    else window.localStorage.removeItem(writeKeyStorageKey);
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
