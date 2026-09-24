---
title: 外部依赖
description: PostgreSQL、ClickHouse、Kafka、Redis 和可选对象存储的要求。
---

生产部署应使用具备备份、监控、认证和故障切换能力的依赖服务。

## 拓扑

| 依赖 | 职责 | 必需 |
| --- | --- | --- |
| **PostgreSQL** | 用户、组织、项目、密钥、Release、Issue 工作流与审计状态 | 是 |
| **ClickHouse** | 不可变事件与查询聚合 | 是 |
| **Kafka** | 接收与持久化之间的耐久缓冲 | 是 |
| **Redis** | 配额、短期状态与速率限制 | 是 |
| **对象存储** | Source Map Artifact 和未来大对象（OSS 或 S3 兼容） | 否 |

## PostgreSQL

只允许服务私网访问，启用 TLS、备份和时间点恢复。参见 [PostgreSQL](/zh/docs/self-hosting/postgres/)。

## ClickHouse

容量必须覆盖原始事件、聚合、保留期和合并空间。参见 [ClickHouse](/zh/docs/self-hosting/clickhouse/)。

## Kafka

生产确认必须保证耐久写入，保留时间要覆盖可接受的 Consumer 停机窗口。参见 [Kafka](/zh/docs/self-hosting/kafka/)。

## Redis

Redis 不是事实来源，但其故障会影响限流、缓存和短期状态。参见 [Redis](/zh/docs/self-hosting/redis/)。

## 对象存储

不需要 Source Map 时可以不配置。启用后使用私有 Bucket、最小权限和工作负载身份。参见[对象存储](/zh/docs/self-hosting/object-storage/)。

## 容量起点

不要从演示流量推导生产容量。使用实际信封大小、事件率、保留期、查询并发和故障恢复窗口进行压测，参见[容量规划](/zh/docs/self-hosting/capacity/)。
