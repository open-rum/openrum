---
title: 确定性 Demo 数据
description: 安全地复现本地电商调查数据集。
---

OpenRUM 在 `services/api/cmd/demo` 提供幂等数据生成器。它创建开发用 Owner、Organization 和商城 Project，并向 ClickHouse 写入确定性的电商数据。

## 数据范围

当前数据集覆盖 14 天，大致包括：

- 30,000 个 Session、12,000 个匿名访客和约 549,000 个 Event
- Page View、导航、点击、商品、购物车、结账和订单 Event
- 归一化 Route 上的 LCP、INP、CLS
- 32 个 API Route、不同方法、耗时、响应大小和失败组合
- 结账、JavaScript 和 Chunk 加载错误，以及可用于 Source Map UI 的映射
- 国家、设备、浏览器、操作系统、渠道、Campaign、商品分类和会员等级

流量遵循小时和工作日/周末模式；转化率、延迟和失败率随渠道和设备变化。商品 Route 会归一化为 `/products/:id`。

## Compose 自动造数

首次启动时，`demo-seed` 会在迁移完成后自动执行：

```sh
docker compose --env-file deploy/compose/.env.example -f deploy/compose/docker-compose.yml up -d --build
docker compose --env-file deploy/compose/.env.example -f deploy/compose/docker-compose.yml logs demo-seed
```

开发账号：

```text
Email: demo@openrum.local
Password: OpenRUM-demo-2026!
```

如果 Instance 已由其他 Owner 初始化且不存在 Demo Owner，生成器会退出且不修改数据。

## 再次运行

```sh
docker compose --env-file deploy/compose/.env.example -f deploy/compose/docker-compose.yml run --rm --no-deps --build demo-seed
```

也可以直接连接本地 Compose 依赖：

```sh
POSTGRES_DSN='postgres://openrum:openrum_local_only@127.0.0.1:5433/openrum?sslmode=disable' \
CLICKHOUSE_DSN='clickhouse://openrum:openrum_local_only@127.0.0.1:9000/openrum' \
go run ./services/api/cmd/demo
```

命令完成后会打印 Project ID；首次创建 Project 时还会打印一次 SDK 写入 Key，请仅用于本地开发。

## 幂等与重置

数据集使用版本标记和确定性 Event ID，同一版本重复运行不会产生重复 Event。更改生成器后如需写入新数据，必须递增数据集版本，并先删除 Demo Project 在原始表和聚合表中的旧数据，否则物化视图会把两版数据相加。

完整本地重置会永久删除当前 Compose Project 的数据库和对象存储卷：

```sh
docker compose --env-file deploy/compose/.env.example -f deploy/compose/docker-compose.yml down --volumes
docker compose --env-file deploy/compose/.env.example -f deploy/compose/docker-compose.yml up -d --build
```

不要把示例 DSN 指向测试或生产环境。

## 验证

造数完成后打开 `http://127.0.0.1:4173`：

1. 在“分析”检查国家分布和商品到订单漏斗。
2. 在“性能”检查 `/products/:id` 的 LCP、INP、CLS。
3. 在“API”检查端点、失败和 P95 延迟。
4. 在“错误”检查错误分组和映射后的源码位置。

```sh
go test ./services/api/cmd/demo
```
