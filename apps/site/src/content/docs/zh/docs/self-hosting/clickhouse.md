---
title: ClickHouse
description: 运维事件存储、聚合与查询新鲜度。
---

**负责人：** 数据/平台值班 · **主要保护：** Kafka 保留与未提交的 Consumer Offset

## 触发条件与影响

关注 `OpenRUMClickHouseInsertErrors`、`OpenRUMDataFreshnessHigh`、查询高延迟和副本健康。
Kafka 仍有保留余量时 Ingest 可以继续接收；Consumer 插入失败后重试且不提交 Offset，
此时大盘会变旧，并应展示数据延迟提示。

## 安全处置

1. 记录集群健康、副本、磁盘/inode、Merge/Mutation、拒绝查询、Kafka Lag 和首个插入错误。
2. 保护接收耐久性：预计排空时间逼近 Kafka 保留期时降低采样；先暂停昂贵查询，再调整 Consumer。
3. 修复磁盘、网络或副本；重试放大压力时缩容 Consumer，但不得跳过或提交失败 Offset。
4. 事故期间禁止无评审执行 `OPTIMIZE FINAL`、大范围 Mutation、删表、删副本或手工去重。

## 恢复与验证

1. 确认副本活跃、队列排空、磁盘余量安全，且 Canary 插入和查询成功。
2. 先恢复一个 Consumer，再逐步扩容，观察插入错误、P99、Kafka Lag 和新鲜度。
3. 用已知事件 ID 验证从 Kafka 到 `rum_events` 的链路；回放虽有幂等 Token，仍需度量重复。
4. Lag 与新鲜度保持基线 30 分钟且无分区阻塞后关闭事故。

## 只读证据查询

```sql
SELECT database, table, is_readonly, absolute_delay, queue_size FROM system.replicas ORDER BY absolute_delay DESC;
SELECT database, table, mutation_id, command, is_done, latest_fail_reason FROM system.mutations WHERE NOT is_done;
SELECT name, path, free_space, total_space FROM system.disks;
```

不要把原始事件字段复制到工单。原始事件使用 `raw_expires_at`，聚合表使用
`aggregate_expires_at`。日常验证不得执行大范围 `MATERIALIZE TTL`；历史策略由受限维护任务处理，
进度通过 `GET /api/v1/admin/maintenance-jobs` 查看。
