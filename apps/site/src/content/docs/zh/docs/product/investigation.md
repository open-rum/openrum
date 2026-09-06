---
title: 行为 → Session → Issue
description: OpenRUM 推荐调查路径。
---

**适用于：** Alpha / main。

OpenRUM 将行为分析与错误监控放在同一条调查路径中，避免在多个工具间复制 ID。

## 推荐路径

1. 在 **分析** 中发现变化：PV/UV、自定义事件、漏斗、地域、设备或浏览器分群。
2. 打开受影响 Route 或人群的 **会话**，按时间查看页面、交互、API 请求与错误。
3. 从错误事件进入 **Issue**，确认 Fingerprint、影响范围、Release 与是否新增。
4. 结合会话上下文与失败 API 确认根因；配置对象存储后可查看 Source Map 帧。

## Demo 路径

完成本地快速开始后，可按电商 Demo 路径验证：商品行为 → checkout 会话 → `v1:demo-checkout` Issue → 失败的 `POST /api/orders`。
