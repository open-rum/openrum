import type { ErrorEvent } from "@openrum/protocol";
import type { OpenRUMClient } from "./client.ts";
import { sanitizeAttributes, sanitizeMeasurements, scrubText } from "./privacy/scrub.ts";
import type { Diagnostics } from "./safety.ts";

export interface CustomEventInput {
  attributes?: Record<string, unknown>;
  measurements?: Record<string, unknown>;
}

export interface BreadcrumbInput {
  category: string;
  message: string;
  level?: "debug" | "info" | "warning" | "error";
  data?: Record<string, unknown>;
  timestamp?: string;
}

export type Breadcrumb = NonNullable<ErrorEvent["breadcrumbs"]>[number];

export function captureCustomEvent(
  client: OpenRUMClient,
  diagnostics: Diagnostics,
  name: string,
  input: CustomEventInput = {},
): void {
  if (!name || name.length > 80 || name.startsWith("openrum.")) {
    diagnostics.droppedEvents += 1;
    return;
  }
  const attributes = sanitizeAttributes(input.attributes, diagnostics);
  const measurements = sanitizeMeasurements(input.measurements, diagnostics);
  client.addBreadcrumb({
    category: name === "ui.click" ? "ui.click" : "custom",
    message: name,
    ...(attributes ? { data: attributes } : {}),
  });
  client.capture({
    type: "custom",
    name,
    ...(attributes ? { attributes } : {}),
    ...(measurements ? { measurements } : {}),
  });
}

export function sanitizeBreadcrumb(
  diagnostics: Diagnostics,
  input: BreadcrumbInput,
  fallbackTimestamp: string,
): Breadcrumb | undefined {
  if (
    !input.category ||
    input.category.length > 64 ||
    !input.message ||
    input.message.length > 512 ||
    (input.timestamp !== undefined && Number.isNaN(Date.parse(input.timestamp)))
  ) {
    diagnostics.droppedBreadcrumbs += 1;
    return undefined;
  }
  const data = sanitizeAttributes(input.data, diagnostics);
  return {
    timestamp: input.timestamp ?? fallbackTimestamp,
    category: input.category,
    message: scrubText(input.message),
    ...(input.level ? { level: input.level } : {}),
    ...(data ? { data } : {}),
  };
}
