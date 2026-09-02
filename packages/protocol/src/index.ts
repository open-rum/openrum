// Code generated from schema/envelope-v1.json; DO NOT EDIT BY HAND.

export type SchemaVersion = "1.0";
export type EventType = "page_view" | "error" | "web_vital" | "api" | "custom";
export type NavigationType = "navigate" | "reload" | "back_forward" | "prerender" | "route_change";
export type Attributes = Record<string, string>;
export type Measurements = Record<string, number>;

export interface EnvelopeV1 {
  schema_version: SchemaVersion;
  sent_at: string;
  sdk: { name: string; version: string };
  context: EventContext;
  events: EventV1[];
}

export interface EventContext {
  environment: string;
  release?: string;
  dist?: string;
  session_id: string;
  page_id: string;
  anonymous_user_id: string;
  user_id?: string;
  page: { url: string; route?: string; title?: string; referrer?: string };
  trace?: { trace_id: string; span_id?: string };
  tags?: Attributes;
}

export interface EventBase {
  event_id: string;
  timestamp: string;
  sample_rate?: number;
}

export interface PageViewEvent extends EventBase {
  type: "page_view";
  navigation_type: NavigationType;
}

export interface ErrorEvent extends EventBase {
  type: "error";
  error: { name: string; message: string; stack?: string; handled: boolean; mechanism?: string };
  fingerprint?: string[];
  breadcrumbs?: Array<{
    timestamp: string;
    category: string;
    message: string;
    level?: "debug" | "info" | "warning" | "error";
    data?: Attributes;
  }>;
}

export interface WebVitalEvent extends EventBase {
  type: "web_vital";
  metric: {
    name: "LCP" | "INP" | "CLS" | "FCP" | "TTFB";
    value: number;
    delta?: number;
    rating: "good" | "needs-improvement" | "poor";
    navigation_type?: NavigationType;
  };
}

export interface APIEvent extends EventBase {
  type: "api";
  request: {
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";
    url: string;
    status?: number;
    duration_ms: number;
    transfer_size?: number;
    failure?: "network" | "timeout" | "abort" | "http";
  };
}

export interface CustomEvent extends EventBase {
  type: "custom";
  name: string;
  attributes?: Attributes;
  measurements?: Measurements;
}

export type EventV1 = PageViewEvent | ErrorEvent | WebVitalEvent | APIEvent | CustomEvent;
