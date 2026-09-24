---
title: 安全与隐私默认值
description: 采集边界、RBAC、CSRF 与密钥处理。
---

**适用于：** Alpha。

## 采集边界

Browser SDK 默认排除 query、body、header、Cookie 与输入框原始值。疑似敏感字段会在浏览器侧清洗，ingest 还会再次校验有界 schema。

自定义事件不要发送邮箱、手机号、支付信息、认证 Token 或自由文本。`setUser` 请使用不透明账号 ID。

## 认证与授权

认证使用服务端 Session、HttpOnly Cookie、同源 CSRF 校验与服务端 RBAC。Instance 角色与 Organization 角色分离。危险的 Instance 变更需要近期二次认证提升。

管理 API 不会回传 Secret。环境托管凭证只读；可选托管值使用外部主密钥做信封加密。审计记录包含 Request ID 与不含 body 的摘要。

## 对外暴露前

- 阅读[威胁模型](/zh/docs/self-hosting/security/threat-model/)
- 通过[漏洞报告](/zh/docs/self-hosting/security/vulnerability-reporting/)私下提交，不要发公开 Issue
- 终止 TLS，设置 `PUBLIC_BASE_URL`，并通过外部 Secret 注入凭据
