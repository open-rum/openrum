import type { Integration } from "../client.ts";

export type ConsoleLogLevel = "debug" | "log" | "info" | "warn" | "error";
type Listener = (message: string) => void;
type ConsoleTarget = Pick<Console, ConsoleLogLevel>;
const registrations = new WeakMap<ConsoleTarget, Map<ConsoleLogLevel, Set<Listener>>>();

export function consoleLoggingIntegration(options: {
  levels: ConsoleLogLevel[];
  console?: ConsoleTarget;
}): Integration {
  return {
    name: "console-logs",
    setup(client) {
      const target = options.console ?? globalThis.console;
      if (!target) return;
      let methods = registrations.get(target);
      if (!methods) {
        methods = new Map();
        registrations.set(target, methods);
      }
      const teardowns: Array<() => void> = [];
      for (const method of new Set(options.levels)) {
        if (!["debug", "log", "info", "warn", "error"].includes(method)) continue;
        let listeners = methods.get(method);
        if (!listeners) {
          const original = target[method];
          const subscribers = new Set<Listener>();
          let capturing = false;
          const wrapper = function (...args: unknown[]) {
            original.apply(target, args);
            if (capturing) return;
            capturing = true;
            try {
              const message = args
                .slice(0, 20)
                .map((value) =>
                  typeof value === "string"
                    ? value.slice(0, 4096)
                    : value === null || ["number", "boolean", "undefined"].includes(typeof value)
                      ? String(value)
                      : "[Object]",
                )
                .join(" ")
                .slice(0, 4096);
              for (const listener of subscribers) listener(message);
            } catch {
              /* Instrumentation must never change application behavior. */
            } finally {
              capturing = false;
            }
          };
          target[method] = wrapper;
          methods.set(method, subscribers);
          listeners = subscribers;
          // Shared cleanup works even when clients close out of installation order.
          const remove = () => {
            if (subscribers.size) return;
            if (target[method] === wrapper) target[method] = original;
            methods.delete(method);
          };
          cleanup.set(subscribers, remove);
        }
        const listener: Listener = (message) =>
          client.capture({
            type: "log",
            level: method === "log" ? "info" : method,
            message,
            logger: "console",
          });
        const subscribers = listeners;
        subscribers.add(listener);
        teardowns.push(() => {
          subscribers.delete(listener);
          cleanup.get(subscribers)?.();
        });
      }
      return () => teardowns.forEach((teardown) => teardown());
    },
  };
}

const cleanup = new WeakMap<Set<Listener>, () => void>();
