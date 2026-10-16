---
title: API 监控
description: 在会话和问题上下文中观察浏览器发起的网络请求。
appliesTo: Alpha
---

API Request Event 记录浏览器 `fetch`/XHR 的耗时和失败信号。Cookie 永远不会保存，Header 和请求/响应体仅在项目为某个 API 开启后才保存。

## 可以查看什么

- 经过归一化、受基数控制的请求 Route
- Session 时间线中的耗时与失败标记
- 从失败请求跳转到阻断用户的 Issue

## 默认隐私保护

SDK 会排除查询参数、Cookie，以及 OpenRUM 自己的 Ingest 地址；除非项目为某个 API 开启，否则不会读取任何 Header 或请求/响应体。参见[隐私](/zh/docs/self-hosting/security/privacy/)。

## 请求头、响应头和请求/响应体

`content-type`、`etag`、`cache-control`、`x-request-id` 这类 Header 常能解释一次变慢或失败的请求。它们**默认关闭**，按 API 单独开启：

1. 打开 **设置 → 数据管理 → API 头信息**，或在请求详情里点 **管理头信息采集**。后一种方式会以你正在查看的端点预填一条规则。
2. 添加规则：HTTP 方法（或任意）、API 监控中显示的端点（例如 `https://api.example.com/orders/:id`，其中 `:id` 代表一个标识符段，`*` 可匹配一类端点），要记录的请求头和响应头名称，以及是否记录请求体、响应体或两者。
3. 保存。Owner 和 Admin 可以修改规则。浏览器约 5 分钟内拿到变更，Consumer 约 30 秒内生效；只记录变更之后发生的请求。

已记录的 Header 和请求/响应体显示在请求的 **详情** 标签页 **附加信息** 中；JSON 会缩进显示，被脱敏或截断的内容会有标注。它们在请求发生 3 天后删除，`authorization`、`cookie` 这类凭证 Header 永远无法记录。

请求/响应体是 SDK 能采集到的最敏感的内容。只读取不超过 64 KB 的文本、JSON 和表单，最多保留 4 KB；名字像密码、令牌、邮箱、手机号或银行卡号的字段会被替换成 `[REDACTED]`；自由文本无法完全清洗。具体保证参见[按 API 开启的 Header 与请求体采集](/zh/docs/self-hosting/security/privacy/#按-api-开启的-header-与请求体采集)。

相关文档：[问题调查](/zh/docs/product/investigation/)、[Browser SDK](/zh/docs/sdk/browser/)。
