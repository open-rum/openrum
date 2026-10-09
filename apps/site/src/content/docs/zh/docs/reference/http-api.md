---
title: HTTP API
description: Alpha 阶段 Console、Ingest、SDK 分发和健康检查的 HTTP 接口概览。
appliesTo: Alpha
---

OpenRUM 对外提供四类 HTTP 接口：

| 接口面 | 常见路径 | 使用方 |
| --- | --- | --- |
| **Ingest** | `/ingest/v1/envelope` | Browser SDK |
| **SDK 分发** | `/sdk/browser/{version}/openrum.min.js` | 不使用 Bundler 的网页 |
| **Console API** | `/api/*` | 已认证 Console 和运维人员 |
| **健康检查** | `/health/live`、`/health/ready` | 编排系统和本地检查 |

## Ingest

Browser SDK 向 Ingest 提交有界 Envelope。HTTP 成功表示 Kafka 已持久确认。Payload 会经过 Schema 校验和隐私清洗；限流请求返回 `429`、`Retry-After` 以及 OpenRUM 诊断 Header。参见[速率限制](/zh/docs/product/rate-limits/)、[Event Schema](/zh/docs/reference/event-schema/)和 [Browser SDK](/zh/docs/sdk/browser/)。

## SDK 分发

Instance 提供版本化 IIFE 构建，当前地址为 `/sdk/browser/0.1.1/openrum.min.js`，在 `window.OpenRUM` 暴露 API。脚本公开、允许 CORS 并缓存一年；修改内容必须发布新版本 URL。

## Console API

Console API 由 Session Cookie、CSRF 和 RBAC 保护。Project ID 本身不是授权凭据，服务端始终检查成员关系。

紧急存储恢复使用三个仅供 Console 的维护接口：预览可清理分区、经 Instance Owner 重新认证后创建任务、查询最新任务。请优先使用[存储压力](/zh/docs/self-hosting/storage-pressure/)中的引导流程，而不是将其当作公共自动化 API。

## 健康检查

```sh
curl --fail http://127.0.0.1:4173/health/ready
```

Alpha API 在首个稳定 Release 前可能变化；优先使用 Browser SDK 和文档化的 Console 流程。
