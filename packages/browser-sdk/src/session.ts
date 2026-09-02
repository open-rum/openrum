import type { Diagnostics } from "./safety.ts";
import { runSafely } from "./safety.ts";

const SESSION_KEY = "openrum.session.v1";
const ANONYMOUS_USER_KEY = "openrum.anonymous-user.v1";
const DEFAULT_SESSION_TIMEOUT_MS = 30 * 60 * 1000;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface SessionSnapshot {
  sessionId: string;
  pageId: string;
  anonymousUserId: string;
}

export interface SessionDependencies {
  now?: () => number;
  randomUUID?: () => string;
  sessionStorage?: StorageLike;
  localStorage?: StorageLike;
  sessionTimeoutMs?: number;
}

interface StoredSession {
  id: string;
  lastActivityAt: number;
}

export class SessionManager {
  readonly #diagnostics: Diagnostics;
  readonly #now: () => number;
  readonly #randomUUID: () => string;
  readonly #sessionStorage?: StorageLike;
  readonly #localStorage?: StorageLike;
  readonly #sessionTimeoutMs: number;
  readonly #anonymousUserId: string;
  #session: StoredSession;
  #pageId: string;

  constructor(diagnostics: Diagnostics, dependencies: SessionDependencies = {}) {
    this.#diagnostics = diagnostics;
    this.#now = dependencies.now ?? Date.now;
    this.#randomUUID = dependencies.randomUUID ?? createUUID;
    this.#sessionStorage = dependencies.sessionStorage ?? browserStorage("sessionStorage");
    this.#localStorage = dependencies.localStorage ?? browserStorage("localStorage");
    this.#sessionTimeoutMs = dependencies.sessionTimeoutMs ?? DEFAULT_SESSION_TIMEOUT_MS;
    this.#anonymousUserId = this.#loadAnonymousUser();
    this.#session = this.#loadSession();
    this.#pageId = this.#randomUUID();
  }

  snapshot(): SessionSnapshot {
    const now = this.#now();
    if (now - this.#session.lastActivityAt >= this.#sessionTimeoutMs) {
      this.#session = { id: this.#randomUUID(), lastActivityAt: now };
    } else {
      this.#session.lastActivityAt = now;
    }
    this.#write(this.#sessionStorage, SESSION_KEY, JSON.stringify(this.#session));
    return {
      sessionId: this.#session.id,
      pageId: this.#pageId,
      anonymousUserId: this.#anonymousUserId,
    };
  }

  startPage(): string {
    this.#pageId = this.#randomUUID();
    return this.#pageId;
  }

  #loadSession(): StoredSession {
    const now = this.#now();
    const raw = this.#read(this.#sessionStorage, SESSION_KEY);
    if (raw) {
      const parsed = runSafely<StoredSession | null>(this.#diagnostics, null, () =>
        JSON.parse(raw),
      );
      if (
        parsed &&
        typeof parsed.id === "string" &&
        Number.isFinite(parsed.lastActivityAt) &&
        now - parsed.lastActivityAt < this.#sessionTimeoutMs
      ) {
        return { id: parsed.id, lastActivityAt: now };
      }
    }
    const session = { id: this.#randomUUID(), lastActivityAt: now };
    this.#write(this.#sessionStorage, SESSION_KEY, JSON.stringify(session));
    return session;
  }

  #loadAnonymousUser(): string {
    const current = this.#read(this.#localStorage, ANONYMOUS_USER_KEY);
    if (current) return current;
    const created = `anon_${this.#randomUUID()}`;
    this.#write(this.#localStorage, ANONYMOUS_USER_KEY, created);
    return created;
  }

  #read(storage: StorageLike | undefined, key: string): string | null {
    if (!storage) return null;
    return runSafely(this.#diagnostics, null, () => storage.getItem(key));
  }

  #write(storage: StorageLike | undefined, key: string, value: string): void {
    if (!storage) return;
    runSafely(this.#diagnostics, undefined, () => storage.setItem(key, value));
  }
}

function browserStorage(name: "localStorage" | "sessionStorage"): StorageLike | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window[name];
  } catch {
    return undefined;
  }
}

export function createUUID(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
