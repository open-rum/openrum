import type { EventContext } from "@openrum/protocol";
import type { Diagnostics } from "./safety.ts";
import { runSafely } from "./safety.ts";
import type { SessionManager } from "./session.ts";

export interface ContextOptions {
  environment: string;
  release?: string;
  dist?: string;
}

export interface PageSnapshot {
  url: string;
  route?: string;
  title?: string;
  referrer?: string;
}

export type PageReader = () => PageSnapshot;

export class ContextManager {
  readonly #diagnostics: Diagnostics;
  readonly #session: SessionManager;
  readonly #options: ContextOptions;
  readonly #pageReader: PageReader;
  #userId?: string;
  #tags: Record<string, string> = {};
  #page: PageSnapshot;

  constructor(
    diagnostics: Diagnostics,
    session: SessionManager,
    options: ContextOptions,
    pageReader: PageReader = readBrowserPage,
  ) {
    this.#diagnostics = diagnostics;
    this.#session = session;
    this.#options = options;
    this.#pageReader = pageReader;
    this.#page = this.#readPage();
  }

  snapshot(): EventContext {
    const session = this.#session.snapshot();
    return {
      environment: this.#options.environment,
      ...(this.#options.release ? { release: this.#options.release } : {}),
      ...(this.#options.dist ? { dist: this.#options.dist } : {}),
      session_id: session.sessionId,
      page_id: session.pageId,
      anonymous_user_id: session.anonymousUserId,
      ...(this.#userId ? { user_id: this.#userId } : {}),
      page: { ...this.#page },
      ...(Object.keys(this.#tags).length ? { tags: { ...this.#tags } } : {}),
    };
  }

  startPage(page?: Partial<PageSnapshot>): void {
    this.#session.startPage();
    this.#page = sanitizePage({ ...this.#readPage(), ...page });
  }

  setUser(userId: string | undefined): void {
    this.#userId = userId?.slice(0, 128) || undefined;
  }

  setTag(key: string, value: string | undefined): boolean {
    if (value === undefined) {
      delete this.#tags[key];
      return true;
    }
    if (!(key in this.#tags) && Object.keys(this.#tags).length >= 20) return false;
    this.#tags[key] = value.slice(0, 512);
    return true;
  }

  #readPage(): PageSnapshot {
    return runSafely(this.#diagnostics, { url: "" }, () => sanitizePage(this.#pageReader()));
  }
}

export function readBrowserPage(): PageSnapshot {
  if (typeof location === "undefined") return { url: "" };
  return {
    url: location.href,
    route: location.pathname,
    title: typeof document === "undefined" ? undefined : document.title,
    referrer: typeof document === "undefined" ? undefined : document.referrer,
  };
}

function sanitizePage(page: PageSnapshot): PageSnapshot {
  return {
    url: stripURLDetails(page.url).slice(0, 2048),
    ...(page.route ? { route: page.route.slice(0, 512) } : {}),
    ...(page.title ? { title: page.title.slice(0, 512) } : {}),
    ...(page.referrer ? { referrer: stripURLDetails(page.referrer).slice(0, 2048) } : {}),
  };
}

function stripURLDetails(value: string): string {
  try {
    const parsed = new URL(value);
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return value.split(/[?#]/, 1)[0] ?? "";
  }
}
