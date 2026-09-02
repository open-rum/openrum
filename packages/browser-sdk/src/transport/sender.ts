import type { CapturedEvent, ClientOptions, EventSink } from "../client.ts";
import type { StorageLike } from "../session.ts";
import {
  buildEnvelope,
  encodeEnvelope,
  encodedEnvelopeFits,
  MAX_BATCH_EVENTS,
  MAX_KEEPALIVE_BYTES,
  type CompressionRuntime,
  type EncodedEnvelope,
} from "./envelope.ts";
import { PersistentQueue, type QueueStats } from "./queue.ts";

const SDK_NAME = "@openrum/browser";
const SDK_VERSION = "0.1.0";
const DEFAULT_FLUSH_INTERVAL_MS = 5_000;
const MAX_RETRY_DELAY_MS = 60_000;

export interface SenderRuntime extends CompressionRuntime {
  fetch(input: string, init: RequestInit): Promise<Response>;
  isOnline(): boolean;
  setTimeout(callback: () => void, delay: number): number;
  clearTimeout(handle: number): void;
  addEventListener?(type: string, listener: EventListener): void;
  removeEventListener?(type: string, listener: EventListener): void;
  sendBeacon?(url: string, data: BodyInit): boolean;
  random?: () => number;
  now?: () => number;
  storage?: StorageLike;
}

export interface SenderOptions {
  endpoint: string;
  writeKey: string;
  beaconEndpoint?: string;
  flushIntervalMs?: number;
  storageKey?: string;
}

export interface SenderStats extends QueueStats {
  acceptedBatches: number;
  rejectedBatches: number;
  retryableFailures: number;
  disabled: boolean;
}

export class Sender implements EventSink {
  readonly #options: SenderOptions;
  readonly #runtime: SenderRuntime;
  readonly #queue: PersistentQueue;
  readonly #flushIntervalMs: number;
  readonly #onOnline: EventListener;
  readonly #onPageHide: EventListener;
  #timer?: number;
  #flushPromise?: Promise<void>;
  #retryAttempt = 0;
  #closed = false;
  #disabled = false;
  #acceptedBatches = 0;
  #rejectedBatches = 0;
  #retryableFailures = 0;

  constructor(options: SenderOptions, runtime: SenderRuntime) {
    this.#options = options;
    this.#runtime = runtime;
    this.#flushIntervalMs = options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
    this.#queue = new PersistentQueue({
      storage: runtime.storage,
      storageKey: options.storageKey ?? queueStorageKey(options.endpoint, options.writeKey),
    });
    this.#onOnline = () => this.#schedule(0, true);
    this.#onPageHide = () => {
      if (!this.#flushBeacon()) void this.flush(true);
    };
    runtime.addEventListener?.("online", this.#onOnline);
    runtime.addEventListener?.("pagehide", this.#onPageHide);
    if (this.#queue.stats().queuedEvents) this.#schedule(0, true);
  }

  add(event: CapturedEvent): void {
    if (this.#closed || this.#disabled) return;
    this.#queue.add(event);
    this.#schedule(this.#flushIntervalMs);
  }

  flush(keepalive = false): Promise<void> {
    if (this.#flushPromise) return this.#flushPromise;
    this.#clearTimer();
    this.#flushPromise = this.#drain(keepalive).finally(() => {
      this.#flushPromise = undefined;
    });
    return this.#flushPromise;
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#clearTimer();
    this.#runtime.removeEventListener?.("online", this.#onOnline);
    this.#runtime.removeEventListener?.("pagehide", this.#onPageHide);
    await this.flush(true);
    this.#flushBeacon();
  }

  stats(): SenderStats {
    return {
      ...this.#queue.stats(),
      acceptedBatches: this.#acceptedBatches,
      rejectedBatches: this.#rejectedBatches,
      retryableFailures: this.#retryableFailures,
      disabled: this.#disabled,
    };
  }

  async #drain(keepalive: boolean): Promise<void> {
    if (this.#disabled || !this.#runtime.isOnline()) return;
    while (this.#queue.stats().queuedEvents > 0) {
      const batch = await this.#fittingBatch(keepalive);
      if (!batch) {
        this.#queue.removePrefix(1);
        this.#rejectedBatches += 1;
        continue;
      }
      const outcome = await this.#send(batch.encoded, keepalive);
      if (outcome.kind === "accepted" || outcome.kind === "rejected") {
        this.#queue.removePrefix(batch.count);
        this.#retryAttempt = 0;
        if (outcome.kind === "accepted") this.#acceptedBatches += 1;
        else this.#rejectedBatches += 1;
        continue;
      }
      if (outcome.kind === "disabled") {
        this.#disabled = true;
        this.#queue.clear();
        this.#rejectedBatches += 1;
        return;
      }
      this.#retryableFailures += 1;
      this.#retryAttempt += 1;
      this.#schedule(outcome.retryAfterMs ?? this.#backoffDelay(), true);
      return;
    }
  }

  async #fittingBatch(
    keepalive: boolean,
  ): Promise<{ count: number; encoded: EncodedEnvelope } | undefined> {
    let events = this.#queue.peekBatch(MAX_BATCH_EVENTS);
    while (events.length) {
      const envelope = buildEnvelope(events, { name: SDK_NAME, version: SDK_VERSION });
      const encoded = await encodeEnvelope(envelope, this.#runtime);
      if (encodedEnvelopeFits(encoded, keepalive)) return { count: events.length, encoded };
      if (events.length === 1) return undefined;
      events = events.slice(0, Math.max(1, Math.floor(events.length / 2)));
    }
    return undefined;
  }

  async #send(encoded: EncodedEnvelope, keepalive: boolean): Promise<SendOutcome> {
    try {
      const response = await this.#runtime.fetch(this.#options.endpoint, {
        method: "POST",
        mode: "cors",
        credentials: "omit",
        keepalive,
        headers: {
          "content-type": "application/json",
          "x-openrum-key": this.#options.writeKey,
          ...(encoded.compressed ? { "content-encoding": "gzip" } : {}),
        },
        body: encoded.body as BodyInit,
      });
      if (response.status >= 200 && response.status < 300) return { kind: "accepted" };
      if (response.status === 401 || response.status === 403) return { kind: "disabled" };
      if (response.status === 429 || response.status >= 500) {
        return { kind: "retry", retryAfterMs: retryAfter(response.headers, this.#runtime.now?.()) };
      }
      return { kind: "rejected" };
    } catch {
      return { kind: "retry" };
    }
  }

  #flushBeacon(): boolean {
    if (!this.#options.beaconEndpoint || !this.#runtime.sendBeacon || this.#disabled) return false;
    const events = this.#queue.peekBatch(MAX_BATCH_EVENTS);
    if (!events.length) return false;
    try {
      const body = JSON.stringify(buildEnvelope(events, { name: SDK_NAME, version: SDK_VERSION }));
      if (new TextEncoder().encode(body).byteLength > MAX_KEEPALIVE_BYTES) return false;
      const sent = this.#runtime.sendBeacon(
        this.#options.beaconEndpoint,
        new Blob([body], { type: "application/json" }),
      );
      if (sent) {
        this.#queue.removePrefix(events.length);
        this.#acceptedBatches += 1;
      }
      return sent;
    } catch {
      return false;
    }
  }

  #schedule(delay: number, replace = false): void {
    if (this.#closed || this.#disabled) return;
    if (this.#timer !== undefined && !replace) return;
    if (replace) this.#clearTimer();
    this.#timer = this.#runtime.setTimeout(
      () => {
        this.#timer = undefined;
        void this.flush();
      },
      Math.max(0, delay),
    );
  }

  #clearTimer(): void {
    if (this.#timer === undefined) return;
    this.#runtime.clearTimeout(this.#timer);
    this.#timer = undefined;
  }

  #backoffDelay(): number {
    const exponential = Math.min(MAX_RETRY_DELAY_MS, 1_000 * 2 ** (this.#retryAttempt - 1));
    const jitter = 0.5 + (this.#runtime.random?.() ?? Math.random()) * 0.5;
    return Math.round(exponential * jitter);
  }
}

type SendOutcome =
  | { kind: "accepted" }
  | { kind: "rejected" }
  | { kind: "disabled" }
  | { kind: "retry"; retryAfterMs?: number };

export function createBrowserSender(options: ClientOptions): Sender | undefined {
  if (typeof window === "undefined" || typeof window.fetch !== "function") return undefined;
  let storage: StorageLike | undefined;
  try {
    storage = window.localStorage;
  } catch {
    storage = undefined;
  }
  return new Sender(
    {
      endpoint: options.endpoint,
      writeKey: options.writeKey,
      beaconEndpoint: options.beaconEndpoint,
      flushIntervalMs: options.flushIntervalMs,
    },
    {
      fetch: window.fetch.bind(window),
      isOnline: () => window.navigator.onLine,
      setTimeout: (callback, delay) => window.setTimeout(callback, delay),
      clearTimeout: (handle) => window.clearTimeout(handle),
      addEventListener: (type, listener) => window.addEventListener(type, listener),
      removeEventListener: (type, listener) => window.removeEventListener(type, listener),
      sendBeacon:
        typeof window.navigator.sendBeacon === "function"
          ? (url, data) => window.navigator.sendBeacon(url, data)
          : undefined,
      createGzipStream:
        typeof CompressionStream === "function"
          ? () => new CompressionStream("gzip") as TransformStream<Uint8Array, Uint8Array>
          : undefined,
      storage,
    },
  );
}

function retryAfter(headers: Headers, now = Date.now()): number | undefined {
  try {
    const value = headers.get("retry-after");
    if (!value) return undefined;
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(MAX_RETRY_DELAY_MS, Math.round(seconds * 1_000));
    }
    const date = Date.parse(value);
    if (Number.isNaN(date)) return undefined;
    return Math.min(MAX_RETRY_DELAY_MS, Math.max(0, date - now));
  } catch {
    return undefined;
  }
}

function queueStorageKey(endpoint: string, writeKey: string): string {
  let hash = 0x811c9dc5;
  for (const character of `${endpoint}\u0000${writeKey}`) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return `openrum.queue.v1.${(hash >>> 0).toString(36)}`;
}
