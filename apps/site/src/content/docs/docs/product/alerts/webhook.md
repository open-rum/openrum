---
title: Receive alerts with a webhook
description: Receive alerts as signed JSON on your own HTTPS service and verify that they came from OpenRUM.
appliesTo: Alpha
---

A webhook channel posts each alert as JSON to your HTTPS service. Use it to open tickets, page an on-call tool, or forward alerts to a chat tool OpenRUM does not support natively yet.

## Add the channel

Open **Settings → Notification channels**, select **Webhook**, and enter a public HTTPS address and a signing secret of at least 16 characters. Private, loopback and internal addresses are refused, both when you save and when OpenRUM sends.

## Request

OpenRUM sends a `POST` with `Content-Type: application/json` and two headers:

| Header                | Value                                                                                     |
| --------------------- | ----------------------------------------------------------------------------------------- |
| `X-OpenRUM-Timestamp` | Unix time in seconds                                                                      |
| `X-OpenRUM-Signature` | `v1=` followed by the hex HMAC-SHA256 of `timestamp + "." + body`, keyed with your secret |

```json
{
  "id": "0b6f…",
  "kind": "alert",
  "title": "Error rate spike",
  "message": "错误率 ≥ 阈值（最近 5 分钟）",
  "severity": "critical",
  "projectId": "5d2c…",
  "deepLink": "https://rum.example.com/projects/5d2c…/issues?environment=production&from=…&to=…",
  "occurredAt": "2026-09-29T10:00:00Z",
  "alert": {
    "ruleName": "Error rate spike",
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

A test message has `"kind": "test"` and no `alert` object. Respond with any 2xx status. OpenRUM retries 429 and 5xx responses up to three times.

## Verify the signature

Compute the signature over the raw body and compare it in constant time. Reject requests whose timestamp is more than five minutes old.

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
