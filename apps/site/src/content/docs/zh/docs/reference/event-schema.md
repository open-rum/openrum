---
title: Event Schema
description: OpenRUM Envelope V1 Schema 的完整展开：Browser SDK 发送的数据中每个字段、类型和限制。
appliesTo: schema 1.0
---

<!-- GENERATED: scripts/docs/generate-reference.mjs -->

本页根据 `packages/protocol/schema/envelope-v1.json` 生成，请勿手工修改。

Schema 版本 `1.0`。Browser SDK 每次请求发送一个 **Envelope**。Envelope 必须包含 `schema_version`、`sent_at`、`sdk`、`context`、`events`，并携带 1–100 个 Event。

## Envelope

请求体。

| 字段 | 类型 | 必填 | 限制 |
| --- | --- | --- | --- |
| `schema_version` | string | 是 | 固定为 `1.0` |
| `sent_at` | date-time | 是 | — |
| `sdk` | object | 是 | 字段见下方 |
| `context` | object | 是 | 字段见下方 |
| `events` | Event 数组 | 是 | 1–100 项；每一项是下面某一种 Event |

## `sdk`

是哪个 SDK 生成了这个 Envelope。

| 字段 | 类型 | 必填 | 限制 |
| --- | --- | --- | --- |
| `name` | string | 是 | 1–64 个字符 |
| `version` | string | 是 | 1–32 个字符 |

## `context`

对 Envelope 里每个 Event 都适用的信息。

| 字段 | 类型 | 必填 | 限制 |
| --- | --- | --- | --- |
| `environment` | string | 是 | 1–64 个字符 |
| `release` | string | 否 | 最多 128 个字符 |
| `dist` | string | 否 | 最多 64 个字符 |
| `session_id` | uuid | 是 | — |
| `page_id` | uuid | 是 | — |
| `anonymous_user_id` | string | 是 | 1–128 个字符 |
| `user_id` | string | 否 | 最多 128 个字符 |
| `page` | object | 是 | 字段见下方 |
| `trace` | object | 否 | 字段见下方 |
| `tags` | `map<string, string>` | 否 | 最多 20 项；键 1–64 个字符；值 最多 512 个字符 |

### `context.page`

| 字段 | 类型 | 必填 | 限制 |
| --- | --- | --- | --- |
| `url` | uri | 是 | 最多 2048 个字符 |
| `route` | string | 否 | 最多 512 个字符 |
| `title` | string | 否 | 最多 512 个字符 |
| `referrer` | uri | 否 | 最多 2048 个字符 |

### `context.trace`

| 字段 | 类型 | 必填 | 限制 |
| --- | --- | --- | --- |
| `trace_id` | string | 是 | 匹配 `^[a-f0-9]{32}$` |
| `span_id` | string | 否 | 匹配 `^[a-f0-9]{16}$` |

## Event

`events` 里有 6 种 Event，用 `type` 区分。每个 Event 都带有下面的公共字段，每种再各自增加字段。

| `type` | 记录什么 | 增加的字段（必填的加粗） |
| --- | --- | --- |
| `page_view` | 一次页面访问或路由切换 | **`navigation_type`** |
| `error` | 捕获到的错误，包括堆栈和导致它的操作 | **`error`**, `fingerprint`, `breadcrumbs` |
| `web_vital` | 一项 Core Web Vitals 指标 | **`metric`** |
| `api` | 浏览器发出的一次请求 | **`request`** |
| `custom` | 项目自定义的业务 Event，带属性和度量 | **`name`**, `attributes`, `measurements` |
| `log` | 一条结构化的诊断日志 | **`level`**, **`message`**, `logger`, `attributes` |

### 公共字段

| 字段 | 类型 | 必填 | 限制 |
| --- | --- | --- | --- |
| `event_id` | uuid | 是 | — |
| `type` | string | 是 | 取值：`page_view`、`error`、`web_vital`、`api`、`custom`、`log` |
| `timestamp` | date-time | 是 | — |
| `sample_rate` | number | 否 | > 0, ≤ 1 |

### `page_view`

一次页面访问或路由切换。

| 字段 | 类型 | 必填 | 限制 |
| --- | --- | --- | --- |
| `navigation_type` | string | 是 | 取值：`navigate`、`reload`、`back_forward`、`prerender`、`route_change` |

### `error`

捕获到的错误，包括堆栈和导致它的操作。

| 字段 | 类型 | 必填 | 限制 |
| --- | --- | --- | --- |
| `error` | object | 是 | 字段见下方 |
| `fingerprint` | string 数组 | 否 | 最多 10 项；每一项 最多 128 个字符 |
| `breadcrumbs` | object 数组 | 否 | 最多 50 项；每一项的字段见下方 |

#### `error` 的字段

| 字段 | 类型 | 必填 | 限制 |
| --- | --- | --- | --- |
| `name` | string | 是 | 1–128 个字符 |
| `message` | string | 是 | 最多 2048 个字符 |
| `stack` | string | 否 | 最多 65536 个字符 |
| `handled` | boolean | 是 | — |
| `mechanism` | string | 否 | 最多 64 个字符 |

#### `breadcrumbs` 每一项的字段

| 字段 | 类型 | 必填 | 限制 |
| --- | --- | --- | --- |
| `timestamp` | date-time | 是 | — |
| `category` | string | 是 | 最多 64 个字符 |
| `message` | string | 是 | 最多 512 个字符 |
| `level` | string | 否 | 取值：`debug`、`info`、`warning`、`error` |
| `data` | `map<string, string>` | 否 | 最多 20 项；键 1–64 个字符；值 最多 512 个字符 |

### `web_vital`

一项 Core Web Vitals 指标。

| 字段 | 类型 | 必填 | 限制 |
| --- | --- | --- | --- |
| `metric` | object | 是 | 字段见下方 |

#### `metric` 的字段

| 字段 | 类型 | 必填 | 限制 |
| --- | --- | --- | --- |
| `name` | string | 是 | 取值：`LCP`、`INP`、`CLS`、`FCP`、`TTFB` |
| `value` | number | 是 | ≥ 0 |
| `delta` | number | 否 | — |
| `rating` | string | 是 | 取值：`good`、`needs-improvement`、`poor` |
| `navigation_type` | string | 否 | 取值：`navigate`、`reload`、`back_forward`、`prerender`、`route_change` |

### `api`

浏览器发出的一次请求。

| 字段 | 类型 | 必填 | 限制 |
| --- | --- | --- | --- |
| `request` | object | 是 | 字段见下方 |

#### `request` 的字段

| 字段 | 类型 | 必填 | 限制 |
| --- | --- | --- | --- |
| `method` | string | 是 | 取值：`GET`、`POST`、`PUT`、`PATCH`、`DELETE`、`HEAD`、`OPTIONS` |
| `url` | uri | 是 | 最多 2048 个字符 |
| `status` | integer | 否 | 0–599 |
| `duration_ms` | number | 是 | 0–3600000 |
| `transfer_size` | integer | 否 | ≥ 0 |
| `failure` | string | 否 | 取值：`network`、`timeout`、`abort`、`http` |
| `request_headers` | `map<string, string>` | 否 | 最多 20 项；键 1–64 个字符；值 最多 512 个字符 |
| `response_headers` | `map<string, string>` | 否 | 最多 20 项；键 1–64 个字符；值 最多 512 个字符 |
| `request_body` | string | 否 | 最多 8192 个字符 |
| `response_body` | string | 否 | 最多 8192 个字符 |

### `custom`

项目自定义的业务 Event，带属性和度量。

| 字段 | 类型 | 必填 | 限制 |
| --- | --- | --- | --- |
| `name` | string | 是 | 1–80 个字符 |
| `attributes` | `map<string, string>` | 否 | 最多 20 项；键 1–64 个字符；值 最多 512 个字符 |
| `measurements` | `map<string, number>` | 否 | 最多 20 项；键 1–64 个字符；值 数字 |

### `log`

一条结构化的诊断日志。

| 字段 | 类型 | 必填 | 限制 |
| --- | --- | --- | --- |
| `level` | string | 是 | 取值：`trace`、`debug`、`info`、`warn`、`error`、`fatal` |
| `message` | string | 是 | 1–4096 个字符 |
| `logger` | string | 否 | 最多 80 个字符 |
| `attributes` | `map<string, string>` | 否 | 最多 20 项；键 1–64 个字符；值 最多 512 个字符 |

边界和格式以权威 JSON Schema 为准；`pnpm run protocol:check` 会验证生成的 Go 校验代码。
