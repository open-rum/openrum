---
title: Redis
description: 运维配额、短期状态与速率限制依赖。
---

**负责人：** 平台值班 · **事实来源：** PostgreSQL/ClickHouse，绝不是 Redis

## 触发条件与影响

关注 Readiness、Redis 服务告警、高延迟以及限流、缓存、连接状态操作错误。Redis 支持登录节流、
Ingest 限流、大盘缓存和连接进度；缓存失效可能提高 ClickHouse 压力。

## 安全处置

1. 记录拓扑、切换状态、内存/驱逐、延迟、阻塞客户端、连接数和网络错误。
2. 缓存丢失增加 ClickHouse 压力时降低查询并发或采样，并确认登录和 Ingest 的保守降级行为。
3. 通过 Redis 负责人或供应商切换，必要时更新端点/Secret；先滚动一个 API 与 Ingest 副本验证。
4. 事故期间不得 Flush 数据库、关闭认证/TLS、修改驱逐策略，也不得把连接状态 Key 当作耐久证据。

## 恢复与验证

用带 TTL 的一次性 Key 验证认证读写后删除它；验证登录节流、项目/IP Ingest 限流、缓存填充和连接状态。
持续观察 Redis 错误、驱逐、ClickHouse 查询负载与 API 延迟 30 分钟。

## 本地恢复演练

仅在可丢弃的 Compose Alpha 环境执行：

```sh
docker compose --env-file deploy/compose/.env.example -f deploy/compose/docker-compose.yml ps redis api
docker stop openrum-redis-1
docker exec openrum-api-1 wget -S -O- http://127.0.0.1:8080/health/ready
docker start openrum-redis-1
docker exec openrum-api-1 wget -qO- http://127.0.0.1:8080/health/ready
```

预期 Redis 停止时 Readiness 返回 503，重启后恢复 200，无需事件回放或数据库修复。
