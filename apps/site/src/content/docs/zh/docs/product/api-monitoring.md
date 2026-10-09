---
title: API 监控
description: 在会话和问题上下文中观察浏览器发起的网络请求。
appliesTo: Alpha
---

API Request Event 记录浏览器 `fetch`/XHR 的耗时和失败信号，但不保存请求体、响应体、Header 或 Cookie。

## 可以查看什么

- 经过归一化、受基数控制的请求 Route
- Session 时间线中的耗时与失败标记
- 从失败请求跳转到阻断用户的 Issue

## 默认隐私保护

SDK 会排除查询参数、请求体、Header，以及 OpenRUM 自己的 Ingest 地址。参见[隐私](/zh/docs/self-hosting/security/privacy/)。

相关文档：[问题调查](/zh/docs/product/investigation/)、[Browser SDK](/zh/docs/sdk/browser/)。
