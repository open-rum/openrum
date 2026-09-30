---
title: 用 Webhook 接收告警
description: 在你自己的 HTTPS 服务上接收签名 JSON 格式的告警，并验证请求确实来自 OpenRUM。
---

**适用版本：** Alpha。状态：Alpha 已实现。

Webhook 渠道会把每条告警以 JSON 格式 POST 到你的 HTTPS 服务。可以用它建工单、呼叫值班工具，或者转发到 OpenRUM 还没有原生支持的聊天工具。

## 添加渠道

打开「设置 → 通知渠道」，选择「Webhook」，填写一个公网 HTTPS 地址和至少 16 个字符的签名密钥。无论保存时还是发送时，私有地址、本机地址和内网地址都会被拒绝。

## 请求格式

OpenRUM 发送 `POST` 请求，`Content-Type` 为 `application/json`，并带上两个请求头：

| 请求头                | 值                                                                              |
| --------------------- | ------------------------------------------------------------------------------- |
| `X-OpenRUM-Timestamp` | Unix 时间戳，单位秒                                                             |
| `X-OpenRUM-Signature` | `v1=` 加上以你的密钥对 `timestamp + "." + body` 计算的 HMAC-SHA256 十六进制摘要 |

```json
{
  "id": "0b6f…",
  "kind": "alert",
  "title": "错误率突增",
  "message": "错误率 ≥ 阈值（最近 5 分钟）",
  "severity": "critical",
  "projectId": "5d2c…",
  "deepLink": "https://rum.example.com/projects/5d2c…/issues?environment=production&from=…&to=…",
  "occurredAt": "2026-09-29T10:00:00Z",
  "alert": {
    "ruleName": "错误率突增",
    "projectName": "Web",
    "environment": "production",
    "metric": "error_rate",
    "comparator": "gte",
    "value": 3.5,
    "threshold": 2,
    "unit": "percent",
    "windowMinutes": 5
  }
}
```

测试消息的 `kind` 为 `"test"`，没有 `alert` 对象。返回任意 2xx 状态码即可；遇到 429 或 5xx 时 OpenRUM 最多重试 3 次。

## 验证签名

用原始请求体计算签名，并用常量时间比较。时间戳与当前时间相差超过 5 分钟的请求应当拒绝。

```js
import crypto from "node:crypto";

export function verifyOpenRUM(rawBody, headers, secret) {
  const timestamp = headers["x-openrum-timestamp"];
  const signature = headers["x-openrum-signature"] ?? "";
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const expected =
    "v1=" + crypto.createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  return (
    signature.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  );
}
```
