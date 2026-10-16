// Human-written half of the configuration reference. The variable names, which services require
// them and the per-service listen defaults are read from `internal/config` by
// `generate-reference.mjs`; this file supplies the group, the default and the explanation of each.
// The generator fails when a variable read by the source is missing here, or listed here but no
// longer read, so the page cannot silently drift.
//
// `required` is only for conditions the source cannot express as a plain per-service list.
// Everything else that has no entry in the source's required lists is shown as optional.

export const groups = [
  {
    id: "core",
    en: { title: "Core", intro: "Every service reads these." },
    zh: { title: "基础", intro: "所有服务都会读取。" },
  },
  {
    id: "datastores",
    en: {
      title: "Data stores and queue",
      intro: "Where each service finds PostgreSQL, ClickHouse, Kafka and Redis.",
    },
    zh: {
      title: "数据库与队列",
      intro: "各服务连接 PostgreSQL、ClickHouse、Kafka 和 Redis 的地址。",
    },
  },
  {
    id: "listen",
    en: {
      title: "Listening and shutdown",
      intro: "Where each service listens, and how long it waits when it stops.",
    },
    zh: { title: "监听与停止", intro: "各服务的监听地址，以及停止时等待的时间。" },
  },
  {
    id: "ingest",
    en: {
      title: "Ingest and network identity",
      intro: "How Ingest decides who a caller is and where a visitor is from.",
    },
    zh: { title: "Ingest 与来源识别", intro: "Ingest 如何判断调用方是谁、访客来自哪里。" },
  },
  {
    id: "consumer",
    en: { title: "Consumer", intro: "Throughput of the service that writes events to ClickHouse." },
    zh: { title: "Consumer", intro: "把事件写入 ClickHouse 的服务的吞吐设置。" },
  },
  {
    id: "retention",
    en: {
      title: "Default retention",
      intro:
        "Instance defaults for how long data is kept. An Administrator can change an unlocked value in the Console; setting the variable locks it.",
    },
    zh: {
      title: "默认保留期",
      intro:
        "实例级的数据保留默认值。管理员可以在控制台修改未锁定的项；用环境变量设置后该项即被锁定。",
    },
  },
  {
    id: "mail",
    en: {
      title: "Email (SMTP)",
      intro:
        "Optional outgoing mail for alerts and invitations. Set `SMTP_HOST` to configure it here, or leave it empty and use the Console (Settings, Email service). When the deployment sets it, the Console shows the server read-only.",
    },
    zh: {
      title: "邮件（SMTP）",
      intro:
        "可选，用于发送告警和邀请邮件。设置 `SMTP_HOST` 即在部署里配置；留空则可以在控制台（系统设置，邮件服务）里配置。部署里设置后，控制台只读显示。",
    },
  },
  {
    id: "storage",
    en: {
      title: "Object storage",
      intro:
        "Optional. Needed for Source Maps. The `OSS_*` variables are older names for the same settings and apply when the provider is `oss`.",
    },
    zh: {
      title: "对象存储",
      intro: "可选，Source Map 需要。`OSS_*` 是同一组设置的旧名称，仅在 provider 为 `oss` 时生效。",
    },
  },
  {
    id: "secrets",
    en: {
      title: "Encrypted credentials",
      intro:
        "Lets the Console store notification and storage credentials instead of the runtime Secret.",
    },
    zh: {
      title: "加密凭据",
      intro: "让控制台自己保存通知和存储凭据，而不是放在运行时 Secret 里。",
    },
  },
  {
    id: "pressure",
    en: {
      title: "Storage pressure guard",
      intro:
        "Optional protection for low ClickHouse disk space. The ratios must satisfy hard stop < critical ≤ recovery < warning.",
    },
    zh: {
      title: "存储压力保护",
      intro: "ClickHouse 磁盘空间不足时的可选保护。比例必须满足：硬熔断 < 紧急采样 ≤ 恢复 < 提示。",
    },
  },
];

export const variables = [
  // ---- core
  {
    name: "APP_ENV",
    group: "core",
    default: "—",
    en: "Runtime environment: `development`, `test`, `staging` or `production`. `production` enforces HTTPS and the object-storage endpoint allowlist.",
    zh: "运行环境：`development`、`test`、`staging` 或 `production`。`production` 会强制 HTTPS 并校验对象存储端点白名单。",
  },
  {
    name: "PUBLIC_BASE_URL",
    group: "core",
    default: "—",
    en: "The address people use to open the Console, as an absolute URL such as `https://rum.example.com`. Must be HTTPS in production.",
    zh: "用户打开控制台的地址，绝对 URL，例如 `https://rum.example.com`。生产环境必须是 HTTPS。",
  },
  {
    name: "BOOTSTRAP_TOKEN",
    group: "core",
    default: "—",
    required: { en: "First setup", zh: "首次初始化" },
    en: "One-time token asked for on the `/setup` page when you create the first administrator. Generate it with `openssl rand -hex 32` and keep it in a password manager.",
    zh: "在 `/setup` 页面创建第一个管理员时要求输入的一次性 Token。用 `openssl rand -hex 32` 生成，并保存在密码管理器里。",
  },
  // ---- data stores
  {
    name: "POSTGRES_DSN",
    group: "datastores",
    default: "—",
    en: "PostgreSQL connection string for the control plane (accounts, Projects, rules). URL-encode special characters in the password.",
    zh: "控制面（账号、项目、规则）使用的 PostgreSQL 连接串。密码中的特殊字符需要 URL 编码。",
  },
  {
    name: "CLICKHOUSE_DSN",
    group: "datastores",
    default: "—",
    en: "ClickHouse connection string for events and aggregates, for example `clickhouse://user:password@host:9000/openrum`.",
    zh: "事件与聚合结果使用的 ClickHouse 连接串，例如 `clickhouse://user:password@host:9000/openrum`。",
  },
  {
    name: "KAFKA_BROKERS",
    group: "datastores",
    default: "—",
    en: "Comma-separated Kafka broker addresses, reachable from the service.",
    zh: "以逗号分隔的 Kafka broker 地址，服务必须能访问到。",
  },
  {
    name: "KAFKA_EVENT_TOPIC",
    group: "datastores",
    default: "`rum-events-v1`",
    en: "Topic that carries accepted events from Ingest to Consumer.",
    zh: "承载事件、从 Ingest 流向 Consumer 的 topic。",
  },
  {
    name: "OPENRUM_KAFKA_RETENTION_DURATION",
    group: "datastores",
    default: "`168h`",
    en: "The retention you configured on the Kafka event topic, at least `1h`. Used to estimate how much time Consumer has left to drain a backlog.",
    zh: "你在 Kafka 事件 topic 上配置的保留期，至少 `1h`。用来估算 Consumer 还剩多少时间排空积压。",
  },
  {
    name: "REDIS_ADDR",
    group: "datastores",
    default: "—",
    en: "Redis address (`host:port`) for quotas, status and caches.",
    zh: "Redis 地址（`host:port`），用于配额、状态和缓存。",
  },
  // ---- listen and shutdown
  {
    name: "API_HTTP_ADDR",
    group: "listen",
    listenService: "api",
    en: "Listen address of the API service.",
    zh: "API 服务的监听地址。",
  },
  {
    name: "INGEST_HTTP_ADDR",
    group: "listen",
    listenService: "ingest",
    en: "Listen address of the Ingest service.",
    zh: "Ingest 服务的监听地址。",
  },
  {
    name: "CONSUMER_HTTP_ADDR",
    group: "listen",
    listenService: "consumer",
    en: "Listen address of the Consumer service.",
    zh: "Consumer 服务的监听地址。",
  },
  {
    name: "WORKER_HTTP_ADDR",
    group: "listen",
    listenService: "worker",
    en: "Listen address of the Worker service.",
    zh: "Worker 服务的监听地址。",
  },
  {
    name: "SHUTDOWN_TIMEOUT",
    group: "listen",
    default: "`10s`",
    en: "How long a service waits for in-flight work when it receives a stop signal. A positive duration such as `30s`.",
    zh: "服务收到停止信号后，等待进行中任务完成的时间。正的时长，例如 `30s`。",
  },
  // ---- ingest and network identity
  {
    name: "INGEST_TRUSTED_PROXIES",
    group: "ingest",
    default: "empty",
    zhDefault: "空",
    en: "Comma-separated CIDRs or addresses of the proxies in front of Ingest. When empty, rate limits count the socket peer, so every caller behind a shared proxy counts as one. When set, `X-Forwarded-For` is read from those peers only. Never widen this to the public internet.",
    zh: "以逗号分隔的 CIDR 或地址，指明 Ingest 前面的代理。留空时限流按 socket 对端计数，共享代理后面的所有调用方会被算作同一个。填写后只读取来自这些对端的 `X-Forwarded-For`。切勿放宽到公网。",
  },
  {
    name: "GEO_COUNTRY_HEADER",
    group: "ingest",
    default: "empty",
    zhDefault: "空",
    en: "Header that your edge proxy sets to the visitor's country, for example `CF-IPCountry`. When empty, country is not resolved and is stored as `ZZ`.",
    zh: "由边缘代理写入访客国家的 header，例如 `CF-IPCountry`。留空时不解析国家，统一存为 `ZZ`。",
  },
  {
    name: "GEO_TRUSTED_PROXIES",
    group: "ingest",
    default: "empty",
    zhDefault: "空",
    required: { en: "With `GEO_COUNTRY_HEADER`", zh: "设置 `GEO_COUNTRY_HEADER` 时" },
    en: "Comma-separated CIDRs or addresses whose country header is trusted. Never widen this to the public internet.",
    zh: "以逗号分隔的 CIDR 或地址，只有它们转发的国家 header 才被信任。切勿放宽到公网。",
  },
  {
    name: "INGEST_BASE_URL",
    group: "ingest",
    default: "`PUBLIC_BASE_URL` + `/ingest`",
    en: "Ingest address used by the development data generator. You only need it when Ingest is not reachable under the public origin.",
    zh: "开发数据生成器使用的 Ingest 地址。只有 Ingest 不在公开域名下时才需要设置。",
  },
  // ---- consumer
  {
    name: "OPENRUM_CONSUMER_WORKERS",
    group: "consumer",
    default: "`4`",
    en: "Number of parallel writers per Consumer process, from 1 to 64.",
    zh: "每个 Consumer 进程的并行写入数，取值 1 到 64。",
  },
  {
    name: "OPENRUM_CONSUMER_FLUSH_INTERVAL",
    group: "consumer",
    default: "`10ms`",
    en: "How often a writer flushes a partial batch to ClickHouse, from `1ms` to `1s`.",
    zh: "写入进程把未满的批次刷入 ClickHouse 的间隔，取值 `1ms` 到 `1s`。",
  },
  // ---- retention defaults
  {
    name: "OPENRUM_DEFAULT_RAW_RETENTION_DAYS",
    group: "retention",
    default: "`14`",
    en: "Days to keep raw events, from 1 to 90.",
    zh: "原始事件的保留天数，取值 1 到 90。",
  },
  {
    name: "OPENRUM_DEFAULT_AGGREGATE_RETENTION_DAYS",
    group: "retention",
    default: "`90`",
    en: "Days to keep aggregates, from 1 to 730.",
    zh: "聚合数据的保留天数，取值 1 到 730。",
  },
  {
    name: "OPENRUM_DEFAULT_SOURCEMAP_RETENTION_DAYS",
    group: "retention",
    default: "`0`",
    en: "Days to keep Source Map files, from 0 to 3650. `0` deletes them together with their Release.",
    zh: "Source Map 文件的保留天数，取值 0 到 3650。`0` 表示随 Release 一起删除。",
  },
  // ---- mail
  {
    name: "SMTP_HOST",
    group: "mail",
    default: "empty",
    zhDefault: "空",
    en: "Mail server host name, without a scheme or port. When empty, no deployment mail server is configured and every other `SMTP_*` value must also be empty.",
    zh: "邮件服务器主机名，不带协议和端口。留空表示部署里没有配置邮件服务器，此时其他 `SMTP_*` 也必须为空。",
  },
  {
    name: "SMTP_PORT",
    group: "mail",
    default: "`587`, `465` for `tls`, `25` for `none`",
    zhDefault: "`587`；`tls` 为 `465`，`none` 为 `25`",
    en: "Server port, from 1 to 65535.",
    zh: "服务器端口，取值 1 到 65535。",
  },
  {
    name: "SMTP_SECURITY",
    group: "mail",
    default: "`starttls`",
    en: "`starttls` upgrades a plain connection and refuses to continue without it, `tls` encrypts from the first byte (SMTPS), and `none` sends in the clear for a trusted relay and cannot carry credentials.",
    zh: "`starttls` 先建立普通连接再升级加密，服务器不支持时会拒绝继续；`tls` 从连接开始就加密（SMTPS）；`none` 不加密，只用于可信的内网中继，且不能填写凭据。",
  },
  {
    name: "SMTP_USERNAME",
    group: "mail",
    default: "empty",
    zhDefault: "空",
    en: "Account for the mail server. Set it together with `SMTP_PASSWORD`, or leave both empty for a relay that needs no login.",
    zh: "邮件服务器的账号。需与 `SMTP_PASSWORD` 同时设置；不需要登录的中继，两者都留空。",
  },
  {
    name: "SMTP_PASSWORD",
    group: "mail",
    default: "empty",
    zhDefault: "空",
    en: "Password or app-specific SMTP password. Keep it in the runtime Secret, never in a values file.",
    zh: "密码或服务商提供的 SMTP 专用密码。放进运行时 Secret，不要写进 values 文件。",
  },
  {
    name: "SMTP_FROM",
    group: "mail",
    default: "—",
    required: { en: "With `SMTP_HOST`", zh: "设置 `SMTP_HOST` 时" },
    en: "Sender address, for example `no-reply@example.com` or `OpenRUM <no-reply@example.com>`. Use a domain you control and configure SPF and DKIM for it.",
    zh: "发件人地址，例如 `no-reply@example.com` 或 `OpenRUM <no-reply@example.com>`。使用你控制的域名，并为它配置 SPF 和 DKIM。",
  },
  // ---- object storage
  {
    name: "OBJECT_STORAGE_PROVIDER",
    group: "storage",
    default: "none",
    zhDefault: "无",
    en: "`oss` or `s3`. Leave it empty to run without object storage. It is required as soon as any other `OBJECT_STORAGE_*` value is set.",
    zh: "`oss` 或 `s3`。留空表示不使用对象存储。只要设置了其他 `OBJECT_STORAGE_*`，就必须填写。",
  },
  {
    name: "OBJECT_STORAGE_BUCKET",
    group: "storage",
    default: "—",
    required: { en: "With a provider", zh: "设置 provider 时" },
    en: "Bucket name.",
    zh: "Bucket 名称。",
  },
  {
    name: "OBJECT_STORAGE_REGION",
    group: "storage",
    default: "—",
    required: { en: "With a provider", zh: "设置 provider 时" },
    en: "Bucket region.",
    zh: "Bucket 所在区域。",
  },
  {
    name: "OBJECT_STORAGE_ENDPOINT",
    group: "storage",
    default: "provider default",
    zhDefault: "provider 默认值",
    en: "Custom endpoint, for example for MinIO or an S3-compatible service. An absolute `http(s)` URL without credentials. In production it must be HTTPS, and either an Alibaba Cloud OSS host or listed in the endpoint allowlist.",
    zh: "自定义端点，例如 MinIO 或兼容 S3 的服务。不含凭据的绝对 `http(s)` URL。生产环境必须是 HTTPS，并且是阿里云 OSS 域名或在端点白名单里。",
  },
  {
    name: "OBJECT_STORAGE_FORCE_PATH_STYLE",
    group: "storage",
    default: "`true` for `s3` with an endpoint, otherwise `false`",
    zhDefault: "`s3` 且设置了端点时为 `true`，否则为 `false`",
    en: "Use path-style addressing (`host/bucket`) instead of `bucket.host`. Most self-hosted S3-compatible services need `true`.",
    zh: "使用路径风格寻址（`host/bucket`），而不是 `bucket.host`。多数自建的 S3 兼容服务需要 `true`。",
  },
  {
    name: "OPENRUM_OBJECT_STORAGE_ENDPOINT_ALLOWLIST",
    group: "storage",
    default: "empty",
    zhDefault: "空",
    en: "Comma-separated hosts allowed as the endpoint in production. Alibaba Cloud OSS hosts are always allowed.",
    zh: "生产环境允许作为端点的域名，以逗号分隔。阿里云 OSS 域名始终允许。",
  },
  {
    name: "OPENRUM_OSS_ENDPOINT_ALLOWLIST",
    group: "storage",
    default: "empty",
    zhDefault: "空",
    en: "Older name of `OPENRUM_OBJECT_STORAGE_ENDPOINT_ALLOWLIST`; the new name wins when both are set.",
    zh: "`OPENRUM_OBJECT_STORAGE_ENDPOINT_ALLOWLIST` 的旧名称；两者都设置时以新名称为准。",
  },
  {
    name: "AWS_ACCESS_KEY_ID",
    group: "storage",
    default: "—",
    en: "Access key for the `s3` provider. Set it together with `AWS_SECRET_ACCESS_KEY`. When both are empty, the runtime's IAM role is used.",
    zh: "`s3` provider 的 Access Key。需与 `AWS_SECRET_ACCESS_KEY` 同时设置；两者都为空时使用运行环境的 IAM 角色。",
  },
  {
    name: "AWS_SECRET_ACCESS_KEY",
    group: "storage",
    default: "—",
    en: "Secret key for the `s3` provider. Set it together with `AWS_ACCESS_KEY_ID`.",
    zh: "`s3` provider 的 Secret Key。需与 `AWS_ACCESS_KEY_ID` 同时设置。",
  },
  {
    name: "OSS_ACCESS_KEY_ID",
    group: "storage",
    default: "—",
    en: "Access key for the `oss` provider. Set it together with `OSS_ACCESS_KEY_SECRET`. When both are empty, the runtime's RAM role is used.",
    zh: "`oss` provider 的 Access Key。需与 `OSS_ACCESS_KEY_SECRET` 同时设置；两者都为空时使用运行环境的 RAM 角色。",
  },
  {
    name: "OSS_ACCESS_KEY_SECRET",
    group: "storage",
    default: "—",
    en: "Secret key for the `oss` provider. Set it together with `OSS_ACCESS_KEY_ID`.",
    zh: "`oss` provider 的 Secret Key。需与 `OSS_ACCESS_KEY_ID` 同时设置。",
  },
  {
    name: "OSS_BUCKET",
    group: "storage",
    default: "—",
    en: "Older name of `OBJECT_STORAGE_BUCKET`, used when the provider is `oss`. Setting any `OSS_*` location variable selects `oss` automatically.",
    zh: "`OBJECT_STORAGE_BUCKET` 的旧名称，provider 为 `oss` 时使用。设置任意 `OSS_*` 位置变量会自动选择 `oss`。",
  },
  {
    name: "OSS_ENDPOINT",
    group: "storage",
    default: "—",
    en: "Older name of `OBJECT_STORAGE_ENDPOINT`, used when the provider is `oss`.",
    zh: "`OBJECT_STORAGE_ENDPOINT` 的旧名称，provider 为 `oss` 时使用。",
  },
  {
    name: "OSS_REGION",
    group: "storage",
    default: "—",
    en: "Older name of `OBJECT_STORAGE_REGION`, used when the provider is `oss`.",
    zh: "`OBJECT_STORAGE_REGION` 的旧名称，provider 为 `oss` 时使用。",
  },
  {
    name: "KUBERNETES_SERVICE_HOST",
    group: "storage",
    default: "—",
    en: "Set by Kubernetes in every Pod; do not set it yourself. It only lets the Console label static storage keys as coming from a Kubernetes Secret.",
    zh: "Kubernetes 会在每个 Pod 里自动设置，不需要自己配置。它只用于让控制台把静态存储密钥标注为来自 Kubernetes Secret。",
  },
  // ---- encrypted credentials
  {
    name: "OPENRUM_ALLOW_MANAGED_SECRETS",
    group: "secrets",
    default: "`false`",
    en: "Set to `true` to let the Console store credentials encrypted in PostgreSQL. Requires `OPENRUM_MASTER_KEY`.",
    zh: "设为 `true` 后，控制台可以把凭据加密保存到 PostgreSQL。需要同时设置 `OPENRUM_MASTER_KEY`。",
  },
  {
    name: "OPENRUM_MASTER_KEY",
    group: "secrets",
    default: "—",
    required: { en: "With managed credentials", zh: "启用托管凭据时" },
    en: "Base64 of exactly 32 bytes, for example from `openssl rand -base64 32`. Never stored in PostgreSQL; back it up securely, because encrypted credentials cannot be read without it.",
    zh: "恰好 32 字节的 Base64 值，例如 `openssl rand -base64 32` 的输出。绝不存入 PostgreSQL；请妥善备份，丢失后已加密的凭据无法读取。",
  },
  {
    name: "OPENRUM_MASTER_KEY_ID",
    group: "secrets",
    default: "`v1`",
    en: "Label stored with each encrypted value to tell key generations apart, up to 32 characters.",
    zh: "与每个加密值一起保存的标签，用来区分密钥版本，最长 32 个字符。",
  },
  // ---- storage pressure
  {
    name: "OPENRUM_STORAGE_PRESSURE_GUARD_ENABLED",
    group: "pressure",
    default: "`false`",
    en: "Turns the guard on. It is opt-in because some hosted ClickHouse services do not let applications read `system.disks`.",
    zh: "开启保护。默认关闭，因为部分托管 ClickHouse 不允许应用读取 `system.disks`。",
  },
  {
    name: "OPENRUM_STORAGE_WARNING_FREE_RATIO",
    group: "pressure",
    default: "`0.15`",
    en: "Free-space ratio below which storage pressure is reported. Greater than 0 and at most 1.",
    zh: "剩余空间低于该比例时提示存储压力。大于 0 且不超过 1。",
  },
  {
    name: "OPENRUM_STORAGE_CRITICAL_FREE_RATIO",
    group: "pressure",
    default: "`0.10`",
    en: "Free-space ratio below which emergency sampling starts.",
    zh: "剩余空间低于该比例时启动紧急采样。",
  },
  {
    name: "OPENRUM_STORAGE_HARD_STOP_FREE_RATIO",
    group: "pressure",
    default: "`0.05`",
    en: "Free-space ratio below which Ingest stops accepting events.",
    zh: "剩余空间低于该比例时，Ingest 停止接收事件。",
  },
  {
    name: "OPENRUM_STORAGE_RECOVERY_FREE_RATIO",
    group: "pressure",
    default: "`0.10`",
    en: "Free-space ratio that must be reached before emergency sampling and the hard stop are released.",
    zh: "剩余空间恢复到该比例后，才会解除紧急采样和硬熔断。",
  },
  {
    name: "OPENRUM_STORAGE_EMERGENCY_SAMPLE_RATE",
    group: "pressure",
    default: "`0.10`",
    en: "Sampling cap pushed to Browser SDKs while the guard is active, from 0 to 1.",
    zh: "保护生效期间下发给 Browser SDK 的采样上限，取值 0 到 1。",
  },
  {
    name: "OPENRUM_STORAGE_POLL_INTERVAL",
    group: "pressure",
    default: "`30s`",
    en: "How often ClickHouse disk capacity is checked, from `10s` to `10m`.",
    zh: "检查 ClickHouse 磁盘容量的间隔，取值 `10s` 到 `10m`。",
  },
];
