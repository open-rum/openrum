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
export type { EventPriority, SamplingOptions } from "./sampling.ts";

import { OpenRUMClient, type ClientOptions } from "./client.ts";
import type { BreadcrumbInput, CustomEventInput } from "./custom.ts";
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
  const client = new OpenRUMClient(
    {
      ...options,
      integrations: options.integrations ?? [
        pageIntegration(),
        errorIntegration(),
        webVitalsIntegration(),
        fetchIntegration(options.endpoint),
        xhrIntegration(options.endpoint),
      ],
    },
    {
      sink: sender,
      onClose: () => {
        if (activeClient === client) activeClient = undefined;
      },
    },
  );
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
