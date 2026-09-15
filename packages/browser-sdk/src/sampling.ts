import type { EventType } from "@openrum/protocol";

export interface SamplingOptions {
  eventSampleRate: number;
  apiSampleRate: number;
  errorSampleRate: number;
}

export type EventPriority = "critical" | "normal" | "low";

export const defaultSamplingOptions: SamplingOptions = {
  eventSampleRate: 1,
  apiSampleRate: 0.2,
  errorSampleRate: 1,
};

export function normalizeSamplingOptions(input: Partial<SamplingOptions>): SamplingOptions {
  return {
    eventSampleRate: validRate(input.eventSampleRate, defaultSamplingOptions.eventSampleRate),
    apiSampleRate: validRate(input.apiSampleRate, defaultSamplingOptions.apiSampleRate),
    errorSampleRate: validRate(input.errorSampleRate, defaultSamplingOptions.errorSampleRate),
  };
}

export function sampleRateFor(eventType: EventType, options: SamplingOptions): number {
  if (eventType === "error") return options.errorSampleRate;
  if (eventType === "api") return options.apiSampleRate;
  return options.eventSampleRate;
}

export function shouldSample(
  sessionID: string,
  eventType: EventType,
  options: SamplingOptions,
): boolean {
  const rate = sampleRateFor(eventType, options);
  if (rate <= 0) return false;
  if (rate >= 1) return true;
  const group = eventType === "error" ? "error" : eventType === "api" ? "api" : "event";
  return deterministicFraction(`${sessionID}:${group}`) < rate;
}

export function eventPriority(eventType: EventType): EventPriority {
  if (eventType === "error") return "critical";
  if (eventType === "api" || eventType === "log") return "low";
  return "normal";
}

export function deterministicFraction(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) / 0x1_0000_0000;
}

function validRate(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : fallback;
}
