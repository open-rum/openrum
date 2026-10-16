---
title: 安全与隐私默认值
description: 采集边界、RBAC、CSRF 与密钥处理。
---

**适用于：** Alpha。

## 采集边界

Browser SDK 默认排除 query、body、header、Cookie 与输入框原始值。疑似敏感字段会在浏览器侧清洗，ingest 还会再次校验有界 schema。HTTP Header 和请求/响应体是项目唯一可以按 API 单独开启的内容，参见[按 API 开启的 Header 与请求体采集](#按-api-开启的-header-与请求体采集)。

## 按 API 开启的 Header 与请求体采集

只有 Owner 或 Admin 在 **设置 → 数据管理 → API 头信息** 中指定某个 API 和要记录的内容后才会采集，默认全部关闭。请求体和响应体与 Header 分开选择，两个方向也各自独立。

- **凭证类 Header 无法采集。** 名字含 `auth`、`cookie`、`token`、`secret`、`password`、`session`、`csrf`、`signature`、`api-key` 的 Header，以及 `x-forwarded-for` 这类客户端地址 Header，保存规则时就会被拒绝，SDK 不会读取，归一化阶段也会再次移除。这一点不可配置。
- **由 Consumer 决定，而不是浏览器。** 写入 Key 是公开的，任何人都能提交带 Header 的事件。Consumer 只在项目规则为该方法和端点列出了某个 Header 时才保留它，其余一律丢弃；没有规则就什么都不存。
- **值会被脱敏并限长。** 邮箱、Bearer Token、JWT、银行卡号会被遮盖，同时应用项目自己的脱敏规则；每个值最多 256 个字符，每个方向最多 20 个 Header。
- **请求体与响应体按结构脱敏并截短。** 只读取文本、JSON 和表单，不读取文件、`FormData` 或流；超过 64 KB 的完全不采集，因为 JSON 必须完整才能按键名脱敏。JSON 和表单里名字含 `password`、`token`、`secret`、`authorization`、`cookie`、`session`、`csrf`、`signature`、`api-key`、`email`、`phone`、`card number`、`cvv`、`ssn` 的字段，值会被替换成 `[REDACTED]`；邮箱、Bearer Token、JWT 和银行卡号在任何位置都会被遮盖，项目自己的脱敏规则同样生效。保留内容最多 4 KB，被截断时会明确标注。浏览器先脱敏一次，Consumer 再脱敏一次。
- **自由文本无法完全清洗。** 正文可能带有任何模式都识别不了的个人信息，例如普通字段里的姓名或地址。只对确有需要的 API 开启请求体采集，并优先选择你自己控制的接口的响应一侧。
- **Header 与请求体在 3 天后自动删除**，比事件本身更短；存在期间项目内所有成员都可以查看。请只列出对排查有帮助、且不含个人信息的 Header。

自定义事件不要发送邮箱、手机号、支付信息、认证 Token 或自由文本。`setUser` 请使用不透明账号 ID。

## 认证与授权

认证使用服务端 Session、HttpOnly Cookie、同源 CSRF 校验与服务端 RBAC。Instance 角色与 Organization 角色分离。危险的 Instance 变更需要近期二次认证提升。

管理 API 不会回传 Secret。环境托管凭证只读；可选托管值使用外部主密钥做信封加密。审计记录包含 Request ID 与不含 body 的摘要。

## 对外暴露前

- 阅读[威胁模型](/zh/docs/self-hosting/security/threat-model/)
- 通过[漏洞报告](/zh/docs/self-hosting/security/vulnerability-reporting/)私下提交，不要发公开 Issue
- 终止 TLS，设置 `PUBLIC_BASE_URL`，并通过外部 Secret 注入凭据
