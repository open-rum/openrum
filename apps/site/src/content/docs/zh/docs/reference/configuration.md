---
title: 配置参考
description: OpenRUM 各服务的环境变量参考，自动生成。
appliesTo: Alpha / main
---

<!-- GENERATED: scripts/docs/generate-reference.mjs -->

由 `internal/config/config.go` 生成，请勿手工编辑。

| 变量 | 用途 |
| --- | --- |
| `APP_ENV` | 运行环境：development、test、staging 或 production。 |
| `AWS_ACCESS_KEY_ID` | 可选的服务或特性配置；约束条件见源码中的校验逻辑。 |
| `AWS_SECRET_ACCESS_KEY` | 可选的服务或特性配置；约束条件见源码中的校验逻辑。 |
| `BOOTSTRAP_TOKEN` | 可选的服务或特性配置；约束条件见源码中的校验逻辑。 |
| `CLICKHOUSE_DSN` | Event 与聚合结果的 ClickHouse 连接串。 |
| `GEO_COUNTRY_HEADER` | 由边缘代理注入、携带访客国家的 header（例如 CF-IPCountry）。留空则关闭国家解析并存为 ZZ。 |
| `GEO_TRUSTED_PROXIES` | 以逗号分隔的 CIDR 或地址，只有它们转发的国家 header 才被信任。设置了 GEO_COUNTRY_HEADER 时必填；切勿放宽到公网。 |
| `INGEST_BASE_URL` | 可选的服务或特性配置；约束条件见源码中的校验逻辑。 |
| `INGEST_TRUSTED_PROXIES` | 以逗号分隔的 CIDR 或地址，指明终结上报流量的代理。留空则限流身份继续绑定 socket 对端，此时共享代理后面的所有调用方会被算作同一个。填写后只读取来自这些对端的 X-Forwarded-For；切勿放宽到公网，因为匹配到的一方就能自行决定被限流的身份。 |
| `KAFKA_BROKERS` | 以逗号分隔的 Kafka broker 列表。 |
| `KAFKA_EVENT_TOPIC` | 可选的服务或特性配置；约束条件见源码中的校验逻辑。 |
| `KUBERNETES_SERVICE_HOST` | 可选的服务或特性配置；约束条件见源码中的校验逻辑。 |
| `OBJECT_STORAGE_BUCKET` | 可选的服务或特性配置；约束条件见源码中的校验逻辑。 |
| `OBJECT_STORAGE_ENDPOINT` | 可选的服务或特性配置；约束条件见源码中的校验逻辑。 |
| `OBJECT_STORAGE_FORCE_PATH_STYLE` | 可选的服务或特性配置；约束条件见源码中的校验逻辑。 |
| `OBJECT_STORAGE_PROVIDER` | 可选的 oss 或 s3 provider。 |
| `OBJECT_STORAGE_REGION` | 可选的服务或特性配置；约束条件见源码中的校验逻辑。 |
| `OPENRUM_ALLOW_MANAGED_SECRETS` | 显式开启由 Console 托管的加密凭据。 |
| `OPENRUM_MASTER_KEY` | 恰好 32 字节外部密钥的 Base64 值；绝不存入 PostgreSQL。 |
| `OPENRUM_MASTER_KEY_ID` | 可选的服务或特性配置；约束条件见源码中的校验逻辑。 |
| `OPENRUM_OBJECT_STORAGE_ENDPOINT_ALLOWLIST` | 可选的服务或特性配置；约束条件见源码中的校验逻辑。 |
| `OPENRUM_OSS_ENDPOINT_ALLOWLIST` | 可选的服务或特性配置；约束条件见源码中的校验逻辑。 |
| `OSS_ACCESS_KEY_ID` | 可选的服务或特性配置；约束条件见源码中的校验逻辑。 |
| `OSS_ACCESS_KEY_SECRET` | 可选的服务或特性配置；约束条件见源码中的校验逻辑。 |
| `OSS_BUCKET` | 可选的服务或特性配置；约束条件见源码中的校验逻辑。 |
| `OSS_ENDPOINT` | 可选的服务或特性配置；约束条件见源码中的校验逻辑。 |
| `OSS_REGION` | 可选的服务或特性配置；约束条件见源码中的校验逻辑。 |
| `POSTGRES_DSN` | 控制面 PostgreSQL 连接串。 |
| `PUBLIC_BASE_URL` | Console 的规范 origin；生产环境必须使用 HTTPS。 |
| `REDIS_ADDR` | 用于配额、状态和缓存的 Redis 地址。 |
| `SHUTDOWN_TIMEOUT` | 可选的服务或特性配置；约束条件见源码中的校验逻辑。 |
