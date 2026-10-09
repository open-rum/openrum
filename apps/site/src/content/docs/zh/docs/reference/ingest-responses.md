---
title: Ingest 响应码
description: Ingest 端点会返回的每个状态码和错误码、产生原因，以及 Browser SDK 对它们的处理。
appliesTo: Alpha
---

Browser SDK 把批次发送到 Ingest 端点 `POST /ingest/v1/envelope`。本页列出这个端点可能的应答。当浏览器网络面板里出现不认识的状态码，或者你要自己写一个直接访问 Ingest 的客户端时，可以查这里。各项检查的执行顺序见[事件链路](/zh/docs/self-hosting/event-pipeline/)。

## 请求要求

| 要求 | 说明 |
| --- | --- |
| 方法与路径 | `POST /ingest/v1/envelope` |
| Key | 一个 `X-OpenRUM-Key` 请求头，值为有效的 Project key |
| Content-Type | `application/json` |
| 编码 | 无，或 `gzip` |
| Origin | `Origin` 请求头必须匹配 Project 允许的 Origin 之一 |
| 请求体 | 一个包含 1 到 100 个 Event 的 Envelope |

请求体的大小限制：

| 限制 | 值 |
| --- | --- |
| 未压缩请求体 | 1 MiB |
| 压缩（`gzip`）请求体 | 256 KiB |
| 解压比 | 100 比 1 |

浏览器会先发送 `OPTIONS` 预检。带有效 `Origin` 的预检返回 `204` 和 CORS 头，否则返回 `403` `ORIGIN_REJECTED`。

## 成功响应

| 状态码 | 含义 |
| --- | --- |
| `202 Accepted` | 所有 Event 都已可靠写入 Kafka。响应体是 `{"accepted": N, "rejected": []}` |
| `207 Multi-Status` | Envelope 有效，但部分 Event 无效。`rejected` 把每个无效 Event 列为 `{"eventId", "code"}`，其中 `code` 为 `INVALID_EVENT`，有效的 Event 已被接收。如果一个有效的都没有，`accepted` 为 `0`，也没有任何东西入队 |

成功只表示 **Kafka 已经拿到这些 Event**，不代表它们已经可查询。见[事件链路](/zh/docs/self-hosting/event-pipeline/)。

**存储压力。** 带有 `X-OpenRUM-Storage-Pressure: hard-stop` 头、`accepted` 为 `0` 的 `202`，表示 ClickHouse 已达到硬停止阈值，Instance 拒绝存储数据。它被有意设计成成功响应，这样浏览器会清空队列而不是不断重试。见[存储压力](/zh/docs/self-hosting/storage-pressure/)。

## 错误响应

错误响应是一个 JSON 对象：

```json
{
  "error": {
    "code": "INVALID_KEY",
    "message": "The project key is invalid or revoked.",
    "requestId": "..."
  }
}
```

反馈问题时请带上 `requestId`，它同时也会作为 `X-Request-ID` 返回。

| 状态码 | `error.code` | 原因 | 是否重试 |
| --- | --- | --- | --- |
| `400` | `INVALID_BODY` | 无法读取请求体 | 否 |
| `400` | `INVALID_COMPRESSION` | `gzip` 请求体已损坏 | 否 |
| `400` | `INVALID_ENVELOPE` | Envelope 不符合 schema，或 Event 数为 0 或超过 100 | 否 |
| `400` | `ENVIRONMENT_MISMATCH` | Envelope 的 Environment 没有在该 Project 注册 | 否，需修正 Project 设置或 SDK 的 `environment` |
| `401` | `INVALID_KEY` | key 缺失、重复、未知或已撤销 | 否 |
| `403` | `ORIGIN_REJECTED` | 请求的 `Origin` 不在 Project 允许的范围内 | 否，需在 Project 设置里添加 Origin |
| `413` | `PAYLOAD_TOO_LARGE` | 请求体超过大小限制或解压比 | 否 |
| `415` | `UNSUPPORTED_ENCODING` | `Content-Encoding` 不是 `gzip` | 否 |
| `415` | `UNSUPPORTED_MEDIA_TYPE` | `Content-Type` 不是 `application/json` | 否 |
| `429` | `RATE_LIMITED` | 超过了按 IP 或 Project 的限制 | 是，等待 `Retry-After` 之后 |
| `503` | `INGEST_UNAVAILABLE` | Kafka 没有可靠接收这次写入 | 是，等待 `Retry-After` 之后 |

### 429 的响应头

`429` 带有三个响应头：

| 响应头 | 值 |
| --- | --- |
| `Retry-After` | `1`（秒） |
| `X-OpenRUM-RateLimit-Scope` | `ip` 或 `project` |
| `X-OpenRUM-RateLimit-Limit` | 拒绝这次请求的上限，单位为请求数每秒 |

默认上限是每个 IP 每秒 1,000 个请求、每个 Project 每秒 5,000 个请求。如何调整，以及如何排查持续的 `429`，见[速率限制](/zh/docs/product/rate-limits/)。

## Browser SDK 的处理

| 响应 | SDK 行为 |
| --- | --- |
| `2xx` | 把该批次从队列中移除 |
| `401`、`403` | 视为永久性错误：SDK 清空队列，并停止发送，直到 SDK 被重新初始化 |
| `429`、`5xx` 或没有响应 | 批次保留在队列里并重试。会遵守 `Retry-After`（最多 60 秒），否则按指数退避加抖动，最多 60 秒 |
| 其他 `4xx` | 丢弃该批次，因为再发一次也会以同样方式失败 |

如果单个 Event 大到连独立成一个请求都放不下，SDK 会丢弃它，而不是阻塞队列。

## 按状态码排查

| 你看到的 | 先检查 |
| --- | --- |
| 刚配置完就出现 `401` | SDK 里的 write key 是否对应 Project 设置中仍有效的 key |
| 只有部分页面出现 `403` | Origin 列表。协议、主机和端口都必须匹配，且不允许带路径 |
| `400` `ENVIRONMENT_MISMATCH` | SDK 的 `environment` 选项与 Project 已注册的 Environment 是否一致 |
| `413` | 属性、面包屑或堆栈是否过大，减少发送的内容 |
| 反复出现 `429` | 先看 `X-OpenRUM-RateLimit-Scope`，再看[速率限制](/zh/docs/product/rate-limits/) |
| `503` | Kafka 的健康状况，见 [Kafka 运行手册](/zh/docs/self-hosting/kafka/) |
| 返回 `202` 但 Console 里什么都没有 | [事件链路](/zh/docs/self-hosting/event-pipeline/)，先看 Consumer 积压和过滤规则 |
