export type { EventContext, EventV1, LogEvent, LogLevel } from "@openrum/protocol";
export type { Logger, LogInput, LogAttributes } from "./logs.ts";
export { consoleLoggingIntegration } from "./integrations/console.ts";
export {
  createOpenRUMDSN,
  createOpenRUMDSNForInstance,
  parseOpenRUMDSN,
} from "@openrum/protocol/dsn";
export {
  OpenRUMClient,
  type CapturedEvent,
  type ClientOptions,
  type Environment,
  type EventInput,
  type EventSink,
  type Integration,
} from "./client.ts";
export type { BreadcrumbInput, CustomEventInput } from "./custom.ts";
export { behaviorIntegration, describeTarget } from "./integrations/behavior.ts";
export type {
  BehaviorElement,
  BehaviorIntegrationOptions,
  BehaviorRuntime,
} from "./integrations/behavior.ts";
export type { RemoteSDKConfig } from "./config.ts";
export type { EventPriority, SamplingOptions } from "./sampling.ts";

import { OpenRUMClient, resolveClientOptions, type ClientOptions } from "./client.ts";
import { resolveConfigEndpoint, startRemoteConfig } from "./config.ts";
import type { BreadcrumbInput, CustomEventInput } from "./custom.ts";
import { behaviorIntegration } from "./integrations/behavior.ts";
import { errorIntegration } from "./integrations/errors.ts";
import { fetchIntegration } from "./integrations/fetch.ts";
import { pageIntegration } from "./integrations/page.ts";
import { webVitalsIntegration } from "./integrations/webVitals.ts";
import { xhrIntegration } from "./integrations/xhr.ts";
import { createBrowserSender } from "./transport/sender.ts";
import { createLogger } from "./logs.ts";

let activeClient: OpenRUMClient | undefined;
export const logger = createLogger((log) => activeClient?.capture({ type: "log", ...log }));

export function init(options: ClientOptions): OpenRUMClient {
  if (activeClient?.state === "running") return activeClient;
  const resolved = resolveClientOptions(options);
  const sender = createBrowserSender(resolved);
  const configEndpoint = resolveConfigEndpoint(
    resolved.endpoint,
    resolved.configEndpoint,
    typeof location === "undefined" ? undefined : location.href,
  );
  const client = new OpenRUMClient(
    {
      ...resolved,
      integrations: resolved.integrations ?? [
        pageIntegration(),
        ...(resolved.captureClicks === false ? [] : [behaviorIntegration()]),
        errorIntegration(),
        webVitalsIntegration(),
        fetchIntegration([resolved.endpoint, ...(configEndpoint ? [configEndpoint] : [])]),
        xhrIntegration([resolved.endpoint, ...(configEndpoint ? [configEndpoint] : [])]),
      ],
    },
    {
      sink: sender,
      onClose: () => {
        if (activeClient === client) activeClient = undefined;
      },
    },
  );
  client.registerTeardown(startRemoteConfig(client, resolved));
  activeClient = client;
  return client;
}

export function getClient(): OpenRUMClient | undefined {
  return activeClient;
}

export function captureEvent(name: string, input?: CustomEventInput): void {
  activeClient?.captureEvent(name, input);
}

export function setUser(userId: string | undefined): void {
  activeClient?.setUser(userId);
}

export function setTag(key: string, value: string | undefined): void {
  activeClient?.setTag(key, value);
}

export function addBreadcrumb(input: BreadcrumbInput): void {
  activeClient?.addBreadcrumb(input);
}

export async function close(): Promise<void> {
  await activeClient?.close();
}
