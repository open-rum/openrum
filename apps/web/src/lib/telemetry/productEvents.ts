export const productEventNames = [
  "project_created",
  "first_event_queryable",
  "overview_viewed",
] as const;

export type ProductEventName = (typeof productEventNames)[number];

export type ProductEvent = {
  name: ProductEventName;
  projectId: string;
  occurredAt: string;
};

const storageKey = "openrum:product-events:v1";
const eventType = "openrum:product-event";
const maximumEvents = 32;

export function recordProductEvent(
  name: ProductEventName,
  projectId: string,
  occurredAt = new Date(),
): ProductEvent | null {
  if (!projectId || typeof window === "undefined") return null;
  const timeline = readProductEvents();
  if (timeline.some((event) => event.name === name && event.projectId === projectId)) return null;

  const event = { name, projectId, occurredAt: occurredAt.toISOString() } satisfies ProductEvent;
  try {
    window.sessionStorage.setItem(
      storageKey,
      JSON.stringify([...timeline, event].slice(-maximumEvents)),
    );
  } catch {
    // Product telemetry must never interfere with the monitored application.
  }
  window.performance?.mark?.(`openrum:${name}`);
  window.dispatchEvent(new CustomEvent<ProductEvent>(eventType, { detail: event }));
  return event;
}

export function readProductEvents(): ProductEvent[] {
  if (typeof window === "undefined") return [];
  try {
    const value: unknown = JSON.parse(window.sessionStorage.getItem(storageKey) ?? "[]");
    if (!Array.isArray(value)) return [];
    return value.filter(isProductEvent).slice(-maximumEvents);
  } catch {
    return [];
  }
}

export function magicMomentDuration(projectId: string): number | null {
  const events = readProductEvents().filter((event) => event.projectId === projectId);
  const created = events.find((event) => event.name === "project_created");
  const viewed = events.find((event) => event.name === "overview_viewed");
  if (!created || !viewed) return null;
  return Math.max(0, Date.parse(viewed.occurredAt) - Date.parse(created.occurredAt));
}

function isProductEvent(value: unknown): value is ProductEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Partial<ProductEvent>;
  return (
    productEventNames.includes(event.name as ProductEventName) &&
    typeof event.projectId === "string" &&
    typeof event.occurredAt === "string" &&
    Number.isFinite(Date.parse(event.occurredAt))
  );
}
