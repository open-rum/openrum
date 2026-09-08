---
title: 自部署概览
description: 使用 Compose 评估，使用 Kubernetes/Helm 生产部署。
---

OpenRUM 设计为运行在你自己的基础设施中，不依赖 OpenRUM 云服务。

## 选择路径

| 路径 | 适用场景 |
| --- | --- |
| [Compose](/zh/docs/self-hosting/compose/) | 本地评估、演示与贡献者开发 |
| [Kubernetes / Helm](/zh/docs/self-hosting/kubernetes/) | 生产或共享预发 |
| [外部依赖](/zh/docs/self-hosting/dependencies/) | 了解 PostgreSQL、ClickHouse、Kafka、Redis 与可选对象存储 |

Compose 是单副本评估拓扑。生产应使用 Kubernetes/Helm，并配置生产级依赖、TLS、密钥管理、备份与容量规划。

## 上线前检查

- 终止 TLS，并设置规范的 `PUBLIC_BASE_URL`
- 通过外部 Secret 注入 DSN、bootstrap token 与可选对象存储密钥
- 尽量使用 workload identity
- 配置备份并在隔离环境演练恢复
- 建立保留策略、容量与升级 runbook
- 用真实流量输入完成接近生产的压测
- 阅读[威胁模型](/zh/docs/self-hosting/security/threat-model/)

对象存储可选：没有 Bucket 时，行为、错误、性能、API 和告警继续工作；Source Map 可接 Alibaba OSS 或 S3-compatible 服务。
