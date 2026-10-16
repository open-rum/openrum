---
title: 配置参考
description: OpenRUM 各服务读取的全部环境变量，包含默认值、是否必填和用途。
appliesTo: Alpha
---

<!-- GENERATED: scripts/docs/generate-reference.mjs -->

由 `internal/config` 生成，请勿手工编辑。

这里是 OpenRUM 各服务读取的环境变量。使用 Helm Chart 时，通常通过 [Helm values](/zh/docs/reference/helm-values/) 和运行时 Secret 来设置，不需要手动写这些变量。带凭据的值应放进 Secret，不要写进会提交的 values 文件。

## 基础

所有服务都会读取。

| 变量 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `APP_ENV` | 所有服务 | — | 运行环境：`development`、`test`、`staging` 或 `production`。`production` 会强制 HTTPS 并校验对象存储端点白名单。 |
| `PUBLIC_BASE_URL` | 所有服务 | — | 用户打开控制台的地址，绝对 URL，例如 `https://rum.example.com`。生产环境必须是 HTTPS。 |
| `BOOTSTRAP_TOKEN` | 首次初始化 | — | 在 `/setup` 页面创建第一个管理员时要求输入的一次性 Token。用 `openssl rand -hex 32` 生成，并保存在密码管理器里。 |

## 数据库与队列

各服务连接 PostgreSQL、ClickHouse、Kafka 和 Redis 的地址。

| 变量 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `POSTGRES_DSN` | 所有服务 | — | 控制面（账号、项目、规则）使用的 PostgreSQL 连接串。密码中的特殊字符需要 URL 编码。 |
| `CLICKHOUSE_DSN` | `api`、`consumer`、`worker` | — | 事件与聚合结果使用的 ClickHouse 连接串，例如 `clickhouse://user:password@host:9000/openrum`。 |
| `KAFKA_BROKERS` | `api`、`ingest`、`consumer` | — | 以逗号分隔的 Kafka broker 地址，服务必须能访问到。 |
| `KAFKA_EVENT_TOPIC` | 否 | `rum-events-v1` | 承载事件、从 Ingest 流向 Consumer 的 topic。 |
| `OPENRUM_KAFKA_RETENTION_DURATION` | 否 | `168h` | 你在 Kafka 事件 topic 上配置的保留期，至少 `1h`。用来估算 Consumer 还剩多少时间排空积压。 |
| `REDIS_ADDR` | `api`、`ingest`、`consumer` | — | Redis 地址（`host:port`），用于配额、状态和缓存。 |

## 监听与停止

各服务的监听地址，以及停止时等待的时间。

| 变量 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `API_HTTP_ADDR` | 否 | `:8080` | API 服务的监听地址。 |
| `INGEST_HTTP_ADDR` | 否 | `:8081` | Ingest 服务的监听地址。 |
| `CONSUMER_HTTP_ADDR` | 否 | `:8082` | Consumer 服务的监听地址。 |
| `WORKER_HTTP_ADDR` | 否 | `:8083` | Worker 服务的监听地址。 |
| `SHUTDOWN_TIMEOUT` | 否 | `10s` | 服务收到停止信号后，等待进行中任务完成的时间。正的时长，例如 `30s`。 |

## Ingest 与来源识别

Ingest 如何判断调用方是谁、访客来自哪里。

| 变量 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `INGEST_TRUSTED_PROXIES` | 否 | 空 | 以逗号分隔的 CIDR 或地址，指明 Ingest 前面的代理。留空时限流按 socket 对端计数，共享代理后面的所有调用方会被算作同一个。填写后只读取来自这些对端的 `X-Forwarded-For`。切勿放宽到公网。 |
| `GEO_COUNTRY_HEADER` | 否 | 空 | 由边缘代理写入访客国家的 header，例如 `CF-IPCountry`。留空时不解析国家，统一存为 `ZZ`。 |
| `GEO_TRUSTED_PROXIES` | 设置 `GEO_COUNTRY_HEADER` 时 | 空 | 以逗号分隔的 CIDR 或地址，只有它们转发的国家 header 才被信任。切勿放宽到公网。 |
| `INGEST_BASE_URL` | 否 | `PUBLIC_BASE_URL` + `/ingest` | 开发数据生成器使用的 Ingest 地址。只有 Ingest 不在公开域名下时才需要设置。 |

## Consumer

把事件写入 ClickHouse 的服务的吞吐设置。

| 变量 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `OPENRUM_CONSUMER_WORKERS` | 否 | `4` | 每个 Consumer 进程的并行写入数，取值 1 到 64。 |
| `OPENRUM_CONSUMER_FLUSH_INTERVAL` | 否 | `10ms` | 写入进程把未满的批次刷入 ClickHouse 的间隔，取值 `1ms` 到 `1s`。 |

## 默认保留期

实例级的数据保留默认值。管理员可以在控制台修改未锁定的项；用环境变量设置后该项即被锁定。

| 变量 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `OPENRUM_DEFAULT_RAW_RETENTION_DAYS` | 否 | `14` | 原始事件的保留天数，取值 1 到 90。 |
| `OPENRUM_DEFAULT_AGGREGATE_RETENTION_DAYS` | 否 | `90` | 聚合数据的保留天数，取值 1 到 730。 |
| `OPENRUM_DEFAULT_SOURCEMAP_RETENTION_DAYS` | 否 | `0` | Source Map 文件的保留天数，取值 0 到 3650。`0` 表示随 Release 一起删除。 |

## 邮件（SMTP）

可选，用于发送告警和邀请邮件。设置 `SMTP_HOST` 即在部署里配置；留空则可以在控制台（系统设置，邮件服务）里配置。部署里设置后，控制台只读显示。

| 变量 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `SMTP_HOST` | 否 | 空 | 邮件服务器主机名，不带协议和端口。留空表示部署里没有配置邮件服务器，此时其他 `SMTP_*` 也必须为空。 |
| `SMTP_PORT` | 否 | `587`；`tls` 为 `465`，`none` 为 `25` | 服务器端口，取值 1 到 65535。 |
| `SMTP_SECURITY` | 否 | `starttls` | `starttls` 先建立普通连接再升级加密，服务器不支持时会拒绝继续；`tls` 从连接开始就加密（SMTPS）；`none` 不加密，只用于可信的内网中继，且不能填写凭据。 |
| `SMTP_USERNAME` | 否 | 空 | 邮件服务器的账号。需与 `SMTP_PASSWORD` 同时设置；不需要登录的中继，两者都留空。 |
| `SMTP_PASSWORD` | 否 | 空 | 密码或服务商提供的 SMTP 专用密码。放进运行时 Secret，不要写进 values 文件。 |
| `SMTP_FROM` | 设置 `SMTP_HOST` 时 | — | 发件人地址，例如 `no-reply@example.com` 或 `OpenRUM <no-reply@example.com>`。使用你控制的域名，并为它配置 SPF 和 DKIM。 |

## 对象存储

可选，Source Map 需要。`OSS_*` 是同一组设置的旧名称，仅在 provider 为 `oss` 时生效。

| 变量 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `OBJECT_STORAGE_PROVIDER` | 否 | 无 | `oss` 或 `s3`。留空表示不使用对象存储。只要设置了其他 `OBJECT_STORAGE_*`，就必须填写。 |
| `OBJECT_STORAGE_BUCKET` | 设置 provider 时 | — | Bucket 名称。 |
| `OBJECT_STORAGE_REGION` | 设置 provider 时 | — | Bucket 所在区域。 |
| `OBJECT_STORAGE_ENDPOINT` | 否 | provider 默认值 | 自定义端点，例如 MinIO 或兼容 S3 的服务。不含凭据的绝对 `http(s)` URL。生产环境必须是 HTTPS，并且是阿里云 OSS 域名或在端点白名单里。 |
| `OBJECT_STORAGE_FORCE_PATH_STYLE` | 否 | `s3` 且设置了端点时为 `true`，否则为 `false` | 使用路径风格寻址（`host/bucket`），而不是 `bucket.host`。多数自建的 S3 兼容服务需要 `true`。 |
| `OPENRUM_OBJECT_STORAGE_ENDPOINT_ALLOWLIST` | 否 | 空 | 生产环境允许作为端点的域名，以逗号分隔。阿里云 OSS 域名始终允许。 |
| `OPENRUM_OSS_ENDPOINT_ALLOWLIST` | 否 | 空 | `OPENRUM_OBJECT_STORAGE_ENDPOINT_ALLOWLIST` 的旧名称；两者都设置时以新名称为准。 |
| `AWS_ACCESS_KEY_ID` | 否 | — | `s3` provider 的 Access Key。需与 `AWS_SECRET_ACCESS_KEY` 同时设置；两者都为空时使用运行环境的 IAM 角色。 |
| `AWS_SECRET_ACCESS_KEY` | 否 | — | `s3` provider 的 Secret Key。需与 `AWS_ACCESS_KEY_ID` 同时设置。 |
| `OSS_ACCESS_KEY_ID` | 否 | — | `oss` provider 的 Access Key。需与 `OSS_ACCESS_KEY_SECRET` 同时设置；两者都为空时使用运行环境的 RAM 角色。 |
| `OSS_ACCESS_KEY_SECRET` | 否 | — | `oss` provider 的 Secret Key。需与 `OSS_ACCESS_KEY_ID` 同时设置。 |
| `OSS_BUCKET` | 否 | — | `OBJECT_STORAGE_BUCKET` 的旧名称，provider 为 `oss` 时使用。设置任意 `OSS_*` 位置变量会自动选择 `oss`。 |
| `OSS_ENDPOINT` | 否 | — | `OBJECT_STORAGE_ENDPOINT` 的旧名称，provider 为 `oss` 时使用。 |
| `OSS_REGION` | 否 | — | `OBJECT_STORAGE_REGION` 的旧名称，provider 为 `oss` 时使用。 |
| `KUBERNETES_SERVICE_HOST` | 否 | — | Kubernetes 会在每个 Pod 里自动设置，不需要自己配置。它只用于让控制台把静态存储密钥标注为来自 Kubernetes Secret。 |

## 加密凭据

让控制台自己保存通知和存储凭据，而不是放在运行时 Secret 里。

| 变量 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `OPENRUM_ALLOW_MANAGED_SECRETS` | 否 | `false` | 设为 `true` 后，控制台可以把凭据加密保存到 PostgreSQL。需要同时设置 `OPENRUM_MASTER_KEY`。 |
| `OPENRUM_MASTER_KEY` | 启用托管凭据时 | — | 恰好 32 字节的 Base64 值，例如 `openssl rand -base64 32` 的输出。绝不存入 PostgreSQL；请妥善备份，丢失后已加密的凭据无法读取。 |
| `OPENRUM_MASTER_KEY_ID` | 否 | `v1` | 与每个加密值一起保存的标签，用来区分密钥版本，最长 32 个字符。 |

## 存储压力保护

ClickHouse 磁盘空间不足时的可选保护。比例必须满足：硬熔断 < 紧急采样 ≤ 恢复 < 提示。

| 变量 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `OPENRUM_STORAGE_PRESSURE_GUARD_ENABLED` | 否 | `false` | 开启保护。默认关闭，因为部分托管 ClickHouse 不允许应用读取 `system.disks`。 |
| `OPENRUM_STORAGE_WARNING_FREE_RATIO` | 否 | `0.15` | 剩余空间低于该比例时提示存储压力。大于 0 且不超过 1。 |
| `OPENRUM_STORAGE_CRITICAL_FREE_RATIO` | 否 | `0.10` | 剩余空间低于该比例时启动紧急采样。 |
| `OPENRUM_STORAGE_HARD_STOP_FREE_RATIO` | 否 | `0.05` | 剩余空间低于该比例时，Ingest 停止接收事件。 |
| `OPENRUM_STORAGE_RECOVERY_FREE_RATIO` | 否 | `0.10` | 剩余空间恢复到该比例后，才会解除紧急采样和硬熔断。 |
| `OPENRUM_STORAGE_EMERGENCY_SAMPLE_RATE` | 否 | `0.10` | 保护生效期间下发给 Browser SDK 的采样上限，取值 0 到 1。 |
| `OPENRUM_STORAGE_POLL_INTERVAL` | 否 | `30s` | 检查 ClickHouse 磁盘容量的间隔，取值 `10s` 到 `10m`。 |
