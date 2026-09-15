import type { EventContext, EventV1 } from "@openrum/protocol";
import { parseOpenRUMDSN } from "@openrum/protocol/dsn";
import { ContextManager, type PageReader, type PageSnapshot } from "./context.ts";
import {
  captureCustomEvent,
  sanitizeBreadcrumb,
  type Breadcrumb,
  type BreadcrumbInput,
  type CustomEventInput,
} from "./custom.ts";
import { sanitizeAttribute, sanitizeUserID } from "./privacy/scrub.ts";
import { createLogger, sanitizeLog, type LogInput } from "./logs.ts";
import { consoleLoggingIntegration, type ConsoleLogLevel } from "./integrations/console.ts";
import {
  eventPriority,
  normalizeSamplingOptions,
  sampleRateFor,
  shouldSample,
  type EventPriority,
  type SamplingOptions,
} from "./sampling.ts";
import { compileFilters, type CompiledFilters, type FilterSettings } from "./filters.ts";
import { runSafely, runSafelyAsync, type Diagnostics } from "./safety.ts";
import { createUUID, SessionManager, type SessionDependencies } from "./session.ts";

export interface ClientOptions {
  /** Public connection string copied from the Project's onboarding page. */
  dsn: string;
  environment?: string;
  release?: string;
  dist?: string;
  eventSampleRate?: number;
  apiSampleRate?: number;
  errorSampleRate?: number;
  /** Automatically capture privacy-safe interactive element clicks. Defaults to true. */
  captureClicks?: boolean;
  /** @deprecated Compatibility-only; logger calls and captureConsole are independently explicit. */
  enableLogs?: boolean;
  /** Independently opts into selected console methods. Objects are intentionally not serialized. */
  captureConsole?: ConsoleLogLevel[];
  /** Return null to drop a log. Called before the final privacy scrub. */
  beforeSendLog?: (log: LogInput) => LogInput | null;
  flushIntervalMs?: number;
  /** Optional pre-authenticated endpoint for sendBeacon; never receives the DSN credential. */
  beaconEndpoint?: string;
  /** Defaults to `/api/v1/sdk/config` on the ingest endpoint origin. Set false to disable. */
  configEndpoint?: string | false;
  integrations?: Integration[];
}

export type ResolvedClientOptions = ClientOptions & {
  writeKey: string;
  endpoint: string;
};

export function resolveClientOptions(options: ClientOptions): ResolvedClientOptions {
  return { ...options, ...parseOpenRUMDSN(options.dsn) };
}

export interface CapturedEvent {
  context: EventContext;
  event: EventV1;
  priority: EventPriority;
}

export interface EventSink {
  add(captured: CapturedEvent): void;
  close?(): void | Promise<void>;
}

export interface Integration {
  name: string;
  setup(client: OpenRUMClient): void | (() => void);
}

export interface ClientDependencies extends SessionDependencies {
  pageReader?: PageReader;
  sink?: EventSink;
  nowISO?: () => string;
  onClose?: () => void;
}

type OptionalEventBase<Event extends EventV1> = Omit<Event, "event_id" | "timestamp"> &
  Partial<Pick<Event, "event_id" | "timestamp">>;

export type EventInput = EventV1 extends infer Event
  ? Event extends EventV1
    ? OptionalEventBase<Event>
    : never
  : never;

export class OpenRUMClient {
  readonly options: Readonly<
    Required<Pick<ResolvedClientOptions, "environment">> & ResolvedClientOptions
  >;
  readonly #diagnostics: Diagnostics = {
    internalErrors: 0,
    droppedEvents: 0,
    droppedAttributes: 0,
    droppedBreadcrumbs: 0,
    filteredEvents: 0,
  };
  readonly #context: ContextManager;
  readonly #sink?: EventSink;
  readonly #nowISO: () => string;
  readonly #randomUUID: () => string;
  readonly #onClose?: () => void;
  #sampling: SamplingOptions;
  #filters: CompiledFilters | undefined;
  readonly #teardowns: Array<() => void> = [];
  readonly #breadcrumbs: Breadcrumb[] = [];
  #state: "running" | "closed" = "running";
  #capturingLog = false;
  readonly logger = createLogger((log) => this.capture({ type: "log", ...log }));

  constructor(options: ClientOptions, dependencies: ClientDependencies = {}) {
    this.options = Object.freeze({
      ...resolveClientOptions(options),
      environment: options.environment || "production",
    });
    this.#sink = dependencies.sink;
    this.#nowISO = dependencies.nowISO ?? (() => new Date().toISOString());
    this.#randomUUID = dependencies.randomUUID ?? createUUID;
    this.#onClose = dependencies.onClose;
    this.#sampling = normalizeSamplingOptions(this.options);
    const session = new SessionManager(this.#diagnostics, dependencies);
    this.#context = new ContextManager(
      this.#diagnostics,
      session,
      {
        environment: this.options.environment,
        release: this.options.release,
        dist: this.options.dist,
      },
      dependencies.pageReader,
    );
    const integrations = [...(this.options.integrations ?? [])];
    if (this.options.captureConsole?.length) {
      integrations.push(consoleLoggingIntegration({ levels: this.options.captureConsole }));
    }
    for (const integration of integrations) {
      const teardown = runSafely<ReturnType<Integration["setup"]>>(
        this.#diagnostics,
        undefined,
        () => integration.setup(this),
      );
      if (teardown) this.#teardowns.push(teardown);
    }
  }

  get state(): "running" | "closed" {
    return this.#state;
  }

  getContext(): EventContext {
    return this.#context.snapshot();
  }

  startPage(page?: Partial<PageSnapshot>): void {
    runSafely(this.#diagnostics, undefined, () => this.#context.startPage(page));
  }

  setUser(userId: string | undefined): void {
    runSafely(this.#diagnostics, undefined, () => {
      const sanitized = sanitizeUserID(userId);
      if (userId && !sanitized) {
        this.#diagnostics.droppedAttributes += 1;
        return;
      }
      this.#context.setUser(sanitized);
    });
  }

  setTag(key: string, value: string | undefined): void {
    runSafely(this.#diagnostics, undefined, () => {
      if (value === undefined) {
        this.#context.setTag(key, undefined);
        return;
      }
      const sanitized = sanitizeAttribute(key, value);
      if (!sanitized || !this.#context.setTag(sanitized.key, sanitized.value)) {
        this.#diagnostics.droppedAttributes += 1;
      }
    });
  }

  captureEvent(name: string, input: CustomEventInput = {}): void {
    runSafely(this.#diagnostics, undefined, () =>
      captureCustomEvent(this, this.#diagnostics, name, input),
    );
  }

  addBreadcrumb(input: BreadcrumbInput): void {
    runSafely(this.#diagnostics, undefined, () => {
      const breadcrumb = sanitizeBreadcrumb(this.#diagnostics, input, this.#nowISO());
      if (!breadcrumb) return;
      this.#breadcrumbs.push(breadcrumb);
      if (this.#breadcrumbs.length > 50) this.#breadcrumbs.shift();
    });
  }

  capture(event: EventInput): void {
    const isLog = event.type === "log";
    if (isLog && this.#capturingLog) return;
    if (isLog) this.#capturingLog = true;
    try {
      runSafely(this.#diagnostics, undefined, () => {
        if (event.type === "log") {
          let log = sanitizeLog(event, this.#diagnostics);
          if (!log) return;
          if (this.options.beforeSendLog) {
            const filtered = this.options.beforeSendLog(log);
            if (!filtered) return;
            log = sanitizeLog(filtered, this.#diagnostics);
            if (!log) return;
          }
          event = { type: "log", event_id: event.event_id, timestamp: event.timestamp, ...log };
        }
        if (this.#state !== "running" || !this.#sink) {
          this.#diagnostics.droppedEvents += 1;
          return;
        }
        const context = this.#context.snapshot();
        if (!shouldSample(context.session_id, event.type, this.#sampling)) {
          this.#diagnostics.droppedEvents += 1;
          return;
        }
        // Skipping an upload the consumer would discard anyway. The consumer
        // still applies the full rule set, so this only saves bandwidth.
        if (this.#filters?.shouldDrop(event as EventV1, context)) {
          this.#diagnostics.filteredEvents += 1;
          return;
        }
        const complete = {
          ...event,
          ...(event.type === "error" && !("breadcrumbs" in event) && this.#breadcrumbs.length
            ? { breadcrumbs: this.#breadcrumbs.map((breadcrumb) => ({ ...breadcrumb })) }
            : {}),
          event_id: event.event_id ?? this.#randomUUID(),
          timestamp: event.timestamp ?? this.#nowISO(),
          sample_rate: sampleRateFor(event.type, this.#sampling),
        } as EventV1;
        this.#sink.add({ context, event: complete, priority: eventPriority(event.type) });
      });
    } finally {
      if (isLog) this.#capturingLog = false;
    }
  }

  diagnostics(): Readonly<Diagnostics> {
    return { ...this.#diagnostics };
  }

  /**
   * Replaces the client-side filter set. Called by remote configuration; a
   * document the SDK cannot parse leaves the previous set untouched rather
   * than clearing it, so a bad response cannot quietly re-enable uploads the
   * project asked to stop.
   */
  updateFilters(settings: FilterSettings | undefined): void {
    runSafely(this.#diagnostics, undefined, () => {
      this.#filters = compileFilters(settings);
    });
  }

  updateSampling(options: Partial<SamplingOptions>): void {
    runSafely(this.#diagnostics, undefined, () => {
      this.#sampling = normalizeSamplingOptions({ ...this.#sampling, ...options });
    });
  }

  sampling(): Readonly<SamplingOptions> {
    return { ...this.#sampling };
  }

  registerTeardown(teardown: () => void): void {
    if (this.#state === "running") this.#teardowns.push(teardown);
    else runSafely(this.#diagnostics, undefined, teardown);
  }

  async close(): Promise<void> {
    if (this.#state === "closed") return;
    this.#state = "closed";
    for (const teardown of this.#teardowns.splice(0).reverse()) {
      await runSafelyAsync(this.#diagnostics, teardown);
    }
    if (this.#sink?.close) await runSafelyAsync(this.#diagnostics, () => this.#sink?.close?.());
    runSafely(this.#diagnostics, undefined, () => this.#onClose?.());
  }
}
