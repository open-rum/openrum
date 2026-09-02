import type { CapturedEvent, EventSink } from "../client.ts";
import type { StorageLike } from "../session.ts";

const DEFAULT_MAX_BUFFERED_EVENTS = 1_000;
const DEFAULT_MAX_BUFFERED_BYTES = 1_048_576;

export interface QueueOptions {
  storage?: StorageLike;
  storageKey?: string;
  maxBufferedEvents?: number;
  maxBufferedBytes?: number;
}

export interface QueueStats {
  queuedEvents: number;
  queuedBytes: number;
  droppedEvents: number;
  persistenceErrors: number;
}

export class PersistentQueue implements EventSink {
  readonly #storage?: StorageLike;
  readonly #storageKey: string;
  readonly #maxBufferedEvents: number;
  readonly #maxBufferedBytes: number;
  #items: CapturedEvent[];
  #droppedEvents = 0;
  #persistenceErrors = 0;

  constructor(options: QueueOptions = {}) {
    this.#storage = options.storage;
    this.#storageKey = options.storageKey ?? "openrum.queue.v1";
    this.#maxBufferedEvents = options.maxBufferedEvents ?? DEFAULT_MAX_BUFFERED_EVENTS;
    this.#maxBufferedBytes = options.maxBufferedBytes ?? DEFAULT_MAX_BUFFERED_BYTES;
    this.#items = this.#restore();
    this.#enforceLimits();
  }

  add(event: CapturedEvent): void {
    this.#items.push(event);
    this.#enforceLimits();
    this.#persist();
  }

  peekBatch(maxEvents = 100): CapturedEvent[] {
    const first = this.#items[0];
    if (!first) return [];
    const contextKey = JSON.stringify(first.context);
    const result: CapturedEvent[] = [];
    for (const item of this.#items) {
      if (result.length >= maxEvents || JSON.stringify(item.context) !== contextKey) break;
      result.push(item);
    }
    return result;
  }

  removePrefix(count: number): void {
    if (count <= 0) return;
    this.#items.splice(0, count);
    this.#persist();
  }

  clear(): void {
    this.#items = [];
    this.#persist();
  }

  stats(): QueueStats {
    return {
      queuedEvents: this.#items.length,
      queuedBytes: encodedSize(this.#items),
      droppedEvents: this.#droppedEvents,
      persistenceErrors: this.#persistenceErrors,
    };
  }

  #enforceLimits(): void {
    while (
      this.#items.length > this.#maxBufferedEvents ||
      encodedSize(this.#items) > this.#maxBufferedBytes
    ) {
      const index = evictionIndex(this.#items);
      if (index < 0) break;
      this.#items.splice(index, 1);
      this.#droppedEvents += 1;
    }
  }

  #restore(): CapturedEvent[] {
    if (!this.#storage) return [];
    try {
      const serialized = this.#storage.getItem(this.#storageKey);
      if (!serialized) return [];
      const parsed: unknown = JSON.parse(serialized);
      if (!Array.isArray(parsed)) throw new Error("queue payload is not an array");
      return parsed.filter(isCapturedEvent).slice(-this.#maxBufferedEvents);
    } catch {
      this.#persistenceErrors += 1;
      return [];
    }
  }

  #persist(): void {
    if (!this.#storage) return;
    try {
      this.#storage.setItem(this.#storageKey, JSON.stringify(this.#items));
    } catch {
      this.#persistenceErrors += 1;
    }
  }
}

function evictionIndex(items: CapturedEvent[]): number {
  for (const priority of ["low", "normal", "critical"] as const) {
    const index = items.findIndex((item) => item.priority === priority);
    if (index >= 0) return index;
  }
  return -1;
}

function isCapturedEvent(value: unknown): value is CapturedEvent {
  if (!value || typeof value !== "object") return false;
  try {
    const candidate = value as Partial<CapturedEvent>;
    return Boolean(
      candidate.context &&
      typeof candidate.context.session_id === "string" &&
      candidate.event &&
      typeof candidate.event.event_id === "string" &&
      (candidate.priority === "critical" ||
        candidate.priority === "normal" ||
        candidate.priority === "low"),
    );
  } catch {
    return false;
  }
}

function encodedSize(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}
