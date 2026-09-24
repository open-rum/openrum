---
title: 告警
description: 当生产问题或系统健康信号需要处理时通知运维人员。
---

**适用版本：** Alpha。状态：Alpha 已实现。

告警让团队无需持续盯着 Console，也能及时发现重复出现的生产问题和 Instance 健康异常。

## 常见告警目标

- 按 Fingerprint 识别的新问题或回归问题
- 某个 Release 或 Environment 中升高的错误影响范围
- Ingest、外部依赖或消费延迟等运维健康信号

请谨慎配置通知渠道。Webhook 必须使用公网可访问的 HTTPS 地址；凭据按 Secret 保存，管理 API 不会返回明文。参见[威胁模型](/zh/docs/self-hosting/security/threat-model/)。

相关文档：[问题调查](/zh/docs/product/investigation/)、[故障排查](/zh/docs/self-hosting/troubleshooting/)。
