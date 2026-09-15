---
title: Event schema
description: Generated summary of the canonical OpenRUM Envelope V1 schema.
appliesTo: schema 1.0
---

<!-- GENERATED: scripts/docs/generate-reference.mjs -->

Generated from `packages/protocol/schema/envelope-v1.json`; do not edit by hand.

An Envelope requires `schema_version`, `sent_at`, `sdk`, `context`, `events`. It contains between 1 and 100 Events.

| Event type | Event-specific required fields |
| --- | --- |
| `pageViewEvent` | — |
| `errorEvent` | — |
| `webVitalEvent` | — |
| `apiEvent` | — |
| `customEvent` | — |
| `log` | `event_id`, `type`, `timestamp`, `level`, `message` |

The canonical JSON Schema defines all bounds and formats. Generated Go validation is verified by `pnpm run protocol:check`.
