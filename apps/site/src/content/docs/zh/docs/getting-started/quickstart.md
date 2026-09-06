---
title: 五分钟快速开始
description: 启动本地 OpenRUM Instance 并完成确定性调查路径。
---

**适用版本：** Alpha / main。**前置条件：** Docker 与 Compose v2。

## 1. 启动 Instance

在仓库根目录执行：

```sh
docker compose --env-file deploy/compose/.env.example \
  -f deploy/compose/docker-compose.yml up -d --build
```

等待 Web、API、Ingest、Consumer、Worker、PostgreSQL、ClickHouse、Kafka 与 Redis 健康：

```sh
docker compose -f deploy/compose/docker-compose.yml ps
curl --fail http://127.0.0.1:4173/health/ready
```

打开 `http://127.0.0.1:4173`，使用本地演示账号：

```text
email: demo@openrum.local
password: OpenRUM-demo-2026!
```

这些凭据仅用于本地评估。共享部署前请修改或删除。

## 2. 验证调查路径

1. 打开 **分析**，查看国家、设备与浏览器数据。
2. 打开 **会话**，过滤 Route `/checkout`，选择带错误的 Session。
3. 跟随错误事件进入 **Issue**，查看受影响用户、breadcrumbs 与失败的 `POST /api/orders`。
4. 打开 **Releases** 了解未配置对象存储时 Source Map 不可用是预期行为。

## 3. 重置确定性数据

```sh
docker compose -f deploy/compose/docker-compose.yml down -v
docker compose --env-file deploy/compose/.env.example \
  -f deploy/compose/docker-compose.yml up -d --build
```

该命令只会删除本地 Compose 命名卷。下一步：[创建第一个项目](/zh/docs/getting-started/create-first-project/)。
