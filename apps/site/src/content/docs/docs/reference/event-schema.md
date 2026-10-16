---
title: Event schema
description: The OpenRUM Envelope V1 schema, expanded to every field, type and limit of the data a Browser SDK sends.
appliesTo: schema 1.0
---

<!-- GENERATED: scripts/docs/generate-reference.mjs -->

Generated from `packages/protocol/schema/envelope-v1.json`; do not edit by hand.

Schema version `1.0`. A Browser SDK sends one **Envelope** per request. An Envelope requires `schema_version`, `sent_at`, `sdk`, `context`, `events`, and carries between 1 and 100 Events.

## Envelope

The request body.

| Field | Type | Required | Limits |
| --- | --- | --- | --- |
| `schema_version` | string | Yes | always `1.0` |
| `sent_at` | date-time | Yes | — |
| `sdk` | object | Yes | fields listed below |
| `context` | object | Yes | fields listed below |
| `events` | array of Event | Yes | 1–100 items; each is one of the Event kinds below |

## `sdk`

Which SDK produced the Envelope.

| Field | Type | Required | Limits |
| --- | --- | --- | --- |
| `name` | string | Yes | 1–64 characters |
| `version` | string | Yes | 1–32 characters |

## `context`

What applies to every Event in the Envelope.

| Field | Type | Required | Limits |
| --- | --- | --- | --- |
| `environment` | string | Yes | 1–64 characters |
| `release` | string | No | up to 128 characters |
| `dist` | string | No | up to 64 characters |
| `session_id` | uuid | Yes | — |
| `page_id` | uuid | Yes | — |
| `anonymous_user_id` | string | Yes | 1–128 characters |
| `user_id` | string | No | up to 128 characters |
| `page` | object | Yes | fields listed below |
| `trace` | object | No | fields listed below |
| `tags` | `map<string, string>` | No | up to 20 entries; keys 1–64 characters; values up to 512 characters |

### `context.page`

| Field | Type | Required | Limits |
| --- | --- | --- | --- |
| `url` | uri | Yes | up to 2048 characters |
| `route` | string | No | up to 512 characters |
| `title` | string | No | up to 512 characters |
| `referrer` | uri | No | up to 2048 characters |

### `context.trace`

| Field | Type | Required | Limits |
| --- | --- | --- | --- |
| `trace_id` | string | Yes | matches `^[a-f0-9]{32}$` |
| `span_id` | string | No | matches `^[a-f0-9]{16}$` |

## Events

`events` holds 6 kinds of Event, told apart by `type`. Every Event carries the common fields below, and each kind adds its own.

| `type` | What it records | Fields it adds (required in bold) |
| --- | --- | --- |
| `page_view` | A page view or a route change | **`navigation_type`** |
| `error` | A captured error, with its stack and the actions that led to it | **`error`**, `fingerprint`, `breadcrumbs` |
| `web_vital` | A Core Web Vitals measurement | **`metric`** |
| `api` | A request the browser made | **`request`** |
| `custom` | A project-defined business Event with attributes and measurements | **`name`**, `attributes`, `measurements` |
| `log` | A structured diagnostic log line | **`level`**, **`message`**, `logger`, `attributes` |

### Common fields

| Field | Type | Required | Limits |
| --- | --- | --- | --- |
| `event_id` | uuid | Yes | — |
| `type` | string | Yes | one of `page_view`, `error`, `web_vital`, `api`, `custom`, `log` |
| `timestamp` | date-time | Yes | — |
| `sample_rate` | number | No | > 0, ≤ 1 |

### `page_view`

A page view or a route change.

| Field | Type | Required | Limits |
| --- | --- | --- | --- |
| `navigation_type` | string | Yes | one of `navigate`, `reload`, `back_forward`, `prerender`, `route_change` |

### `error`

A captured error, with its stack and the actions that led to it.

| Field | Type | Required | Limits |
| --- | --- | --- | --- |
| `error` | object | Yes | fields listed below |
| `fingerprint` | array of string | No | up to 10 items; each item up to 128 characters |
| `breadcrumbs` | array of object | No | up to 50 items; each item's fields are listed below |

#### `error` fields

| Field | Type | Required | Limits |
| --- | --- | --- | --- |
| `name` | string | Yes | 1–128 characters |
| `message` | string | Yes | up to 2048 characters |
| `stack` | string | No | up to 65536 characters |
| `handled` | boolean | Yes | — |
| `mechanism` | string | No | up to 64 characters |

#### `breadcrumbs` item fields

| Field | Type | Required | Limits |
| --- | --- | --- | --- |
| `timestamp` | date-time | Yes | — |
| `category` | string | Yes | up to 64 characters |
| `message` | string | Yes | up to 512 characters |
| `level` | string | No | one of `debug`, `info`, `warning`, `error` |
| `data` | `map<string, string>` | No | up to 20 entries; keys 1–64 characters; values up to 512 characters |

### `web_vital`

A Core Web Vitals measurement.

| Field | Type | Required | Limits |
| --- | --- | --- | --- |
| `metric` | object | Yes | fields listed below |

#### `metric` fields

| Field | Type | Required | Limits |
| --- | --- | --- | --- |
| `name` | string | Yes | one of `LCP`, `INP`, `CLS`, `FCP`, `TTFB` |
| `value` | number | Yes | ≥ 0 |
| `delta` | number | No | — |
| `rating` | string | Yes | one of `good`, `needs-improvement`, `poor` |
| `navigation_type` | string | No | one of `navigate`, `reload`, `back_forward`, `prerender`, `route_change` |

### `api`

A request the browser made.

| Field | Type | Required | Limits |
| --- | --- | --- | --- |
| `request` | object | Yes | fields listed below |

#### `request` fields

| Field | Type | Required | Limits |
| --- | --- | --- | --- |
| `method` | string | Yes | one of `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, `OPTIONS` |
| `url` | uri | Yes | up to 2048 characters |
| `status` | integer | No | 0–599 |
| `duration_ms` | number | Yes | 0–3600000 |
| `transfer_size` | integer | No | ≥ 0 |
| `failure` | string | No | one of `network`, `timeout`, `abort`, `http` |
| `request_headers` | `map<string, string>` | No | up to 20 entries; keys 1–64 characters; values up to 512 characters |
| `response_headers` | `map<string, string>` | No | up to 20 entries; keys 1–64 characters; values up to 512 characters |
| `request_body` | string | No | up to 8192 characters |
| `response_body` | string | No | up to 8192 characters |

### `custom`

A project-defined business Event with attributes and measurements.

| Field | Type | Required | Limits |
| --- | --- | --- | --- |
| `name` | string | Yes | 1–80 characters |
| `attributes` | `map<string, string>` | No | up to 20 entries; keys 1–64 characters; values up to 512 characters |
| `measurements` | `map<string, number>` | No | up to 20 entries; keys 1–64 characters; values numbers |

### `log`

A structured diagnostic log line.

| Field | Type | Required | Limits |
| --- | --- | --- | --- |
| `level` | string | Yes | one of `trace`, `debug`, `info`, `warn`, `error`, `fatal` |
| `message` | string | Yes | 1–4096 characters |
| `logger` | string | No | up to 80 characters |
| `attributes` | `map<string, string>` | No | up to 20 entries; keys 1–64 characters; values up to 512 characters |

The canonical JSON Schema is the authority for bounds and formats. Generated Go validation is verified by `pnpm run protocol:check`.
