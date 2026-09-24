---
title: 备份与恢复
description: 保护控制面状态、事件和可选 Source Map Artifact。
---

## 恢复目标

- PostgreSQL RPO 为 15 分钟，控制面 RTO 为 60 分钟。
- 托管 PostgreSQL 应启用自动物理备份、连续日志/PITR、跨可用区、加密、删除保护和 14 天保留。
- 自建 PostgreSQL 使用 pgBackRest：每周全量、每日差异、持续 WAL 归档到私有加密对象存储。
- 最新成功备份或 WAL 超过 RPO 时告警；至少每季度以及破坏性迁移前执行恢复演练。

## 恢复演练

1. 记录恢复时间点；真实恢复时停止所有 OpenRUM Writer，并将原数据库只读保留。
2. 恢复到新数据库/实例，验证期间绝不覆盖源数据库。
3. 暂不执行新迁移；比较 `openrum_schema_migrations`、行数和约束，再运行 `/app/migrate status all`。
4. 验证 Owner 登录、组织/项目访问、有效 Key Hash、告警配置解密、可回滚元数据写入和审计历史。
5. 先将一个 Canary API 副本接到恢复库，再通过 Kubernetes Secret 和滚动部署切换。
6. 记录实际 RPO/RTO、缺失事务与证据；PostgreSQL 能启动不代表恢复完成。

```bash
pg_dump --format=custom --dbname=<source-dsn> --file=<encrypted-drill.dump>
createdb <new-drill-database>
pg_restore --exit-on-error --single-transaction --dbname=<new-drill-dsn> <encrypted-drill.dump>
psql <new-drill-dsn> -c 'SELECT version, applied_at FROM openrum_schema_migrations ORDER BY version'
```

## 项目删除契约

`DELETE /api/v1/projects/{projectId}` 仅 Owner 可调用且受 CSRF 保护。它会原子地把项目标记为
`deleting`、撤销写入 Key、从 Console/查询 API 隐藏、排队清理并记录审计。

Worker 删除 ClickHouse 中项目的事件、聚合和映射行，验证为零后删除全部 Source Map 对象，
再清理 PostgreSQL 子元数据。任务幂等并退避重试；一分钟空观察窗口会捕获首次清理后到达的
Kafka 或 Distributed Table 数据，清理期限为 24 小时。

任务失败、超过期限或运行 15 分钟时必须告警。不得手工标记完成；保留不含遥测的项目 Tombstone 与删除审计。
