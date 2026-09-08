---
title: SDK options
description: Generated reference for every @openrum/browser initialization option.
appliesTo: "@openrum/browser 0.1.0"
---

<!-- GENERATED: scripts/docs/generate-reference.mjs -->

Generated from `packages/browser-sdk/src/client.ts`; do not edit by hand. Pass these to
`init()` — see [Browser SDK](/docs/sdk/browser/).

| Option | Type | Default | Notes |
| --- | --- | --- | --- |
| `writeKey` | `string` | required | Project write key, sent as the `x-openrum-key` header. Safe to expose. |
| `endpoint` | `string` | required | Full Envelope URL, ending in `/ingest/v1/envelope`. |
| `environment` | `string` | `"production"` | Separates Events from staging and production. |
| `release` | `string` | unset | Required for mapped stack frames. Must match the uploaded Release. |
| `dist` | `string` | unset | Distinguishes builds that share one Release. |
| `eventSampleRate` | `number` | `1` | Page Views, interactions and Custom Events. |
| `apiSampleRate` | `number` | `0.2` | fetch and XHR timing. |
| `errorSampleRate` | `number` | `1` | Errors and unhandled rejections. |
| `captureClicks` | `boolean` | `true` | Privacy-safe descriptions of interactive elements. |
| `flushIntervalMs` | `number` | `5000` | Also flushed on `pagehide` and on reconnect. |
| `beaconEndpoint` | `string` | unset | Pre-authenticated `sendBeacon` URL. Never gets the write key. |
| `configEndpoint` | `string \| false` | endpoint origin | Remote sampling from `/api/v1/sdk/config`. `false` disables it. |
| `integrations` | `Integration[]` | all of the above | Replaces the default set rather than adding to it. |

Sample rates outside 0 to 1 are ignored and the built-in default applies instead, so a typo
cannot silently stop collection. The three rates are decided independently but
deterministically per Session, so a Session is never half-recorded.

`configEndpoint` responses are cached, and an invalid one leaves the locally configured
rates in place. Passing `integrations` replaces the defaults, so a list without the page
integration turns off automatic Page Views.
