export type { EventContext, EventV1 } from "@openrum/protocol";
export {
  OpenRUMClient,
  type CapturedEvent,
  type ClientOptions,
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

import { OpenRUMClient, type ClientOptions } from "./client.ts";
import { resolveConfigEndpoint, startRemoteConfig } from "./config.ts";
import type { BreadcrumbInput, CustomEventInput } from "./custom.ts";
import { behaviorIntegration } from "./integrations/behavior.ts";
import { errorIntegration } from "./integrations/errors.ts";
import { fetchIntegration } from "./integrations/fetch.ts";
import { pageIntegration } from "./integrations/page.ts";
import { webVitalsIntegration } from "./integrations/webVitals.ts";
import { xhrIntegration } from "./integrations/xhr.ts";
import { createBrowserSender } from "./transport/sender.ts";

let activeClient: OpenRUMClient | undefined;

export function init(options: ClientOptions): OpenRUMClient {
  if (activeClient?.state === "running") return activeClient;
  const sender = createBrowserSender(options);
  const configEndpoint = resolveConfigEndpoint(
    options.endpoint,
    options.configEndpoint,
    typeof location === "undefined" ? undefined : location.href,
  );
  const client = new OpenRUMClient(
    {
      ...options,
      integrations: options.integrations ?? [
        pageIntegration(),
        ...(options.captureClicks === false ? [] : [behaviorIntegration()]),
        errorIntegration(),
        webVitalsIntegration(),
        fetchIntegration([options.endpoint, ...(configEndpoint ? [configEndpoint] : [])]),
        xhrIntegration([options.endpoint, ...(configEndpoint ? [configEndpoint] : [])]),
      ],
    },
    {
      sink: sender,
      onClose: () => {
        if (activeClient === client) activeClient = undefined;
      },
    },
  );
  client.registerTeardown(startRemoteConfig(client, options));
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
