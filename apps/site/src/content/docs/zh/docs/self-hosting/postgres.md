---
title: PostgreSQL
description: 运维用户、项目和工作流状态所在的控制面数据库。
---

**负责人：** 数据库/平台值班 · **关键数据：** 租户、认证、项目、Release 和工作流状态

## 触发条件与影响

关注 Readiness、API 5xx、连接耗尽、复制延迟和云数据库告警。PostgreSQL 不可用属于控制面事故；
缓存授权可能让 SDK 流量短暂继续，但登录、配置和控制面写入会退化。

## 安全处置

1. 记录主从状态、连接、锁、CPU/磁盘、WAL/复制延迟、近期迁移和 Helm Revision。
2. 冻结发布与迁移；连接耗尽时降低 API/Worker 副本或连接并发。
3. 按托管数据库流程故障切换；提升副本前隔离旧主库，新端点可写后再更新 Secret 并滚动服务。
4. 未经事故负责人批准，不得终止未知事务、提升落后副本、执行 Down Migration 或覆盖在线主库恢复。

## 恢复与验证

1. 验证迁移状态、读写 Canary、唯一与外键约束，并确认只有一个可写主库。
2. 验证登录、项目密钥认证、SDK 配置读取、可回滚元数据写入和审计记录。
3. 逐步恢复 Worker、API 流量和发布，观察 5xx、延迟、连接和复制延迟 30 分钟。

## 只读证据查询

```sql
SELECT now(), pg_is_in_recovery();
SELECT state, count(*) FROM pg_stat_activity GROUP BY state;
SELECT application_name, state, sync_state, write_lag, flush_lag, replay_lag FROM pg_stat_replication;
```

TCP 可连接并不代表恢复完成。需要读写 Canary、有效登录、租户隔离和审计验证。恢复演练见[备份与恢复](/zh/docs/self-hosting/backup-restore/)。
