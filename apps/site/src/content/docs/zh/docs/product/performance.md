---
title: 性能
description: 通过 Core Web Vitals、Route 性能和体验回归理解真实用户体验。
---

**适用版本：** Alpha。状态：Alpha 已实现。

性能页面用于解释一次真实用户旅程为什么缓慢或不稳定。

## OpenRUM 会采集什么

- 真实 Page View 的 LCP、INP、CLS 等 Core Web Vitals
- 客户端路由切换的 Route 级上下文
- 经常与体验回归相关的浏览器 API Request 耗时

## 建议的调查顺序

1. 按 Release、设备或国家比较 Web Vitals。
2. 某个 Route 回归时打开受影响的 Session。
3. 把缓慢或失败的 API Request 与 Issue 峰值关联起来。

性能指标是调查证据，而不是孤立产品。相关文档：[问题调查](/zh/docs/product/investigation/)、[API 监控](/zh/docs/product/api-monitoring/)。
