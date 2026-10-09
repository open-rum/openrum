---
title: SDK options
description: Generated reference for every @openrum/browser initialization option.
appliesTo: "@openrum/browser 0.1.1"
---

<!-- GENERATED: scripts/docs/generate-reference.mjs -->

Generated from `packages/browser-sdk/src/client.ts`; do not edit by hand. Pass these to
`init()` — see [Browser SDK](/docs/sdk/browser/).

| Option | Type | Default | Notes |
| --- | --- | --- | --- |
| `dsn` | `string` | required | Public Project connection string containing the Ingest URL and write-only client key. |
| `environment` | `Environment` | `"production"` | Separates Events from staging and production. |
| `release` | `string` | unset | Required for mapped stack frames. Must match the uploaded Release. |
| `dist` | `string` | unset | Distinguishes builds that share one Release. |
| `eventSampleRate` | `number` | `1` | Page Views, interactions, Custom Events and opted-in Logs. |
| `apiSampleRate` | `number` | `0.2` | fetch and XHR timing. |
| `errorSampleRate` | `number` | `1` | Errors and unhandled rejections. |
| `captureClicks` | `boolean` | `true` | Privacy-safe descriptions of interactive elements. |
| `enableLogs` | `boolean` | ignored | Compatibility-only; logger calls and captureConsole are independently explicit. |
| `captureConsole` | `ConsoleLogLevel[]` | unset | Opt-in console methods: debug, log, info, warn, error. |
| `beforeSendLog` | `(log: LogInput) => LogInput \| null` | unset | Transforms a log or returns null to drop it; final privacy scrubbing still applies. |
| `flushIntervalMs` | `number` | `5000` | Also flushed on `pagehide` and on reconnect. |
| `beaconEndpoint` | `string` | unset | Pre-authenticated `sendBeacon` URL. Never gets the DSN credential. |
| `configEndpoint` | `string \| false` | DSN origin | Remote sampling from `/api/v1/sdk/config`. `false` disables it. |
| `integrations` | `Integration[]` | all of the above | Replaces the default set rather than adding to it. |

Sample rates outside 0 to 1 are ignored and the built-in default applies instead, so a typo
cannot silently stop collection. The three rates are decided independently but
deterministically per Session, so a Session is never half-recorded.

`configEndpoint` responses are cached, and an invalid one leaves the locally configured
rates in place. Passing `integrations` replaces the defaults, so a list without the page
integration turns off automatic Page Views.
