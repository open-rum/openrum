---
title: 行为 → Session → Issue
description: OpenRUM 推荐调查路径。
---

**适用于：** Alpha。

OpenRUM 将行为分析与错误监控放在同一条调查路径中，避免在多个工具间复制 ID。

## 推荐路径

1. 在 **分析** 中发现变化：PV/UV、自定义事件、漏斗、地域、设备或浏览器分群。
2. 打开受影响 Route 或人群的 **会话**，按时间查看页面、交互、API 请求与错误。
3. 从错误事件进入 **Issue**，确认 Fingerprint、影响范围、Release 与是否新增。
4. 结合会话上下文与失败 API 确认根因；配置对象存储后可查看 Source Map 帧。

## 在 Issue 列表中分诊

Issue 列表为分诊设计。**新问题**、**未分配**、**分配给我**三个快捷筛选一键收窄范围，状态筛选还包含**已回归**：已标记解决、之后又再次出现的 Issue。用复选框选中多行后，可批量标记解决、忽略、重新打开或分配负责人；Viewer 角色可以查看列表，但不能修改。

## Demo 路径

启动本地开发环境并执行 `pnpm openrum seed` 后，可按电商 Demo 路径验证：商品行为 → checkout 会话 → `v1:demo-checkout` Issue → 失败的 `POST /api/orders`。
