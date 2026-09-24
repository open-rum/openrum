---
title: Event Schema
description: OpenRUM Envelope V1 权威 Schema 的生成摘要。
appliesTo: schema 1.0
---

<!-- GENERATED: scripts/docs/generate-reference.mjs -->

本页根据 `packages/protocol/schema/envelope-v1.json` 生成，请勿手工修改。

Envelope 必须包含 `schema_version`、`sent_at`、`sdk`、`context`、`events`，每个 Envelope 可携带 1–100 个 Event。

| Event 类型 | 类型专属必填字段 |
| --- | --- |
| `pageViewEvent` | — |
| `errorEvent` | — |
| `webVitalEvent` | — |
| `apiEvent` | — |
| `customEvent` | — |
| `log` | `event_id`、`type`、`timestamp`、`level`、`message` |

所有边界和格式以权威 JSON Schema 为准；`pnpm run protocol:check` 会验证生成的 Go 校验代码。
