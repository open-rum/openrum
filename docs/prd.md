# PRD — OpenRUM

## 1. Overview

### Product Summary

OpenRUM 是一套开源、自部署的 Web 用户行为分析与错误监控平台。MVP 聚焦 JavaScript SDK、五分钟接入、PV/UV、自定义事件、基础分群与漏斗、行为时间线、错误聚合与 Source Map，并用统一用户/会话上下文连接分析和诊断。

产品面向重视数据自主与使用体验的 Web/H5 团队，并以千万级日 PV 验证可靠性。第一版不复制 Google Analytics 或 Sentry 的全部功能，而是证明一条核心链路：行为数据 60 秒内可见，从异常分群或漏斗直接到达受影响会话、错误与源码线索。

### Objective

本 PRD 覆盖核心 MVP 和 90 天开源 Alpha 所需能力：项目/认证、JS SDK、Go 接入/消费/查询链路、ClickHouse/PostgreSQL 数据模型、数据总览、行为分析、Issues、Source Map、性能/API 辅助诊断、采样/用量、基础告警及 Kubernetes 部署。

### Market Differentiation

实现必须交付高完成度的开源自部署体验，以及行为、错误、页面、请求、用户、会话和版本之间连续下钻的上下文。所有事件共享 project、environment、release、session、user、page 和 trace 等标准维度；国家、设备、浏览器、来源与受治理自定义属性可用于一致分群。

### Magic Moment

用户初始化管理员、创建项目、复制 SDK 配置并刷新页面后，应在 60 秒内看到 PV、UV、关键事件和错误；按国家、设备或浏览器发现异常后，可直接打开受影响会话与错误源码。接入页明确显示“密钥有效、SDK 已连接、事件已接收、数据已聚合”四段状态。

### Success Criteria

- 首次 SDK 请求到总览有效数据：P95 < 60 秒。
- 未参与开发的前端工程师首次接入：P75 < 5 分钟，成功率 ≥ 80%。
- Ingest 可用性 ≥ 99.9%；已接受批次进入 Kafka 成功率 ≥ 99.99%。
- 核心查询 P95 < 2 秒，P99 < 5 秒。
- Source Map 正确标记版本时匹配率 ≥ 95%；错误指纹稳定性 ≥ 99%。
- SDK 核心包 gzip ≤ 30 KB；初始化主线程耗时 P75 < 10 ms；不新增 ≥ 50 ms Long Task。
- 开源 Alpha 项目中，至少 40% 的周活跃项目同时使用行为分析和错误诊断；至少完成 5 个“行为异常 → 会话/错误线索”真实案例。
- Go 核心域测试覆盖率 ≥ 70%，SDK 核心采集与序列化 ≥ 80%。

## 2. Technical Architecture

### Architecture Overview

    flowchart LR
      Browser[Web/H5 + OpenRUM SDK] -->|Envelope + project key| Ingest[Go Ingest]
      Ingest --> Kafka[(Kafka)]
      Kafka --> Consumer[Go Consumer]
      Consumer --> CH[(ClickHouse)]
      Web[React Console] --> API[Go API]
      API --> PG[(PostgreSQL)]
      API --> CH
      Ingest --> Redis[(Redis)]
      API --> Redis
      API -. optional .-> ObjectStorage[(OSS / S3-compatible)]
      Worker[Go Worker] -. optional .-> ObjectStorage
      Worker --> CH
      Worker --> PG
      Worker --> Notify[SMTP / Webhook]
      API -. optional .-> OIDC[OIDC Provider]
      Ingest -. metrics .-> Prom[Prometheus]
      Consumer -. metrics .-> Prom
      API -. metrics .-> Prom

Ingest 完成公钥、Origin、限流、大小和 schema 校验后写 Kafka；只有 Kafka 确认成功才返回 202。Consumer 执行规范化、服务端脱敏、URL 归一化、指纹计算与 ClickHouse 批量写入。PostgreSQL 只保存控制面元数据，可选对象存储保存 Source Map，Redis 不作为事实数据源。

### Chosen Stack

| Layer                    | Choice                            | Rationale                                                            |
| ------------------------ | --------------------------------- | -------------------------------------------------------------------- |
| Frontend                 | React + TypeScript + Vite         | TanStack Router/Query/Table 构建高交互控制台，ECharts 展示时序与分布 |
| Public frontend          | Astro + Starlight + React islands | 静态交付官网和文档；自定义 UI 复用共享 shadcn primitives             |
| Backend                  | Go                                | 高吞吐、低开销、便于 Kubernetes 水平扩展                             |
| Event database           | ClickHouse                        | 追加型、高基数事件和分位数聚合                                       |
| Metadata database        | PostgreSQL                        | 用户、组织、项目、权限、配置、告警和 Source Map 元数据               |
| Queue                    | Kafka                             | 削峰、重放、解耦接入与存储                                           |
| Cache                    | Redis                             | 限流、缓存、短期去重和接入状态                                       |
| Object storage           | Optional OSS or S3-compatible     | Source Map、未来 Replay、附件与冷数据；不阻塞核心监控                |
| Auth                     | Built-in accounts + optional OIDC | 自部署开箱即用，同时预留企业 SSO                                     |
| Analytics/error tracking | Isolated OpenRUM + Prometheus     | dogfooding 与基础设施旁路监控并存                                    |
| Notifications            | SMTP + Webhook                    | 自托管、供应商中立                                                   |
| Payments                 | None                              | 免费、开源、自部署                                                   |

### Stack Integration Guide

1. 建立 pnpm workspace、Go workspace 和统一 Makefile，先让 Web/API/Ingest/Consumer/Worker 本地启动。
2. Docker Compose 提供开发用 PostgreSQL、ClickHouse、Kafka 和 Redis；对象存储由管理员按需选择 OSS 或 S3-compatible Provider。
3. 先执行 PostgreSQL/ClickHouse 迁移，再启动 API/Consumer；服务启动只校验 schema 版本。
4. SDK 与服务端共享 JSON Schema 和生成类型，协议带 schema_version，兼容当前及前一版本。
5. Source Map 由 API 通过所选 Provider 签发预签名上传 URL，Worker 按 project + release + dist + artifact 匹配。
6. 控制台同源访问 /api；会话用 HttpOnly、Secure、SameSite=Lax Cookie，不使用 localStorage JWT。
7. 所有服务暴露 /health/live、/health/ready、/metrics；readiness 检查依赖，liveness 不因短时依赖失败重启。

关键环境变量：

| Variable                                                              | Purpose                          |
| --------------------------------------------------------------------- | -------------------------------- |
| APP_ENV、PUBLIC_BASE_URL                                              | 环境与外部地址                   |
| POSTGRES_DSN、CLICKHOUSE_DSN                                          | 数据库连接                       |
| KAFKA_BROKERS、KAFKA_EVENT_TOPIC                                      | Kafka；topic 默认 rum-events-v1  |
| REDIS_ADDR                                                            | Redis                            |
| SESSION_SECRET、PASSWORD_PEPPER                                       | 会话和密码保护，通过 Secret 注入 |
| OBJECT_STORAGE_PROVIDER                                               | 可选；`oss` 或 `s3`              |
| OBJECT_STORAGE_ENDPOINT、OBJECT_STORAGE_BUCKET、OBJECT_STORAGE_REGION | 所选对象存储连接信息             |
| OSS_ACCESS_KEY_ID、OSS_ACCESS_KEY_SECRET                              | OSS 且无 RAM Role 时使用         |
| AWS_ACCESS_KEY_ID、AWS_SECRET_ACCESS_KEY                              | S3 且无 IAM/Workload Role 时使用 |
| SMTP_HOST、SMTP_PORT、SMTP_USERNAME、SMTP_PASSWORD                    | SMTP                             |
| OIDC_ISSUER_URL、OIDC_CLIENT_ID、OIDC_CLIENT_SECRET                   | 可选 OIDC                        |

约束：浏览器 CORS 只允许项目白名单 Origin；不采 Authorization、Cookie、Set-Cookie、body；ClickHouse 必须批量写入；Kafka key 使用 project_id + session hash；URL 聚合前删除 query/hash 并归一化动态段；Redis 丢失只能降级性能，不能损坏正确性。

### Repository Structure

    openrum/
    ├── apps/site/               # 静态公共站、产品页面与 /docs
    ├── apps/web/src/
    │   ├── app/                 # Router、providers、shell
    │   ├── components/ui/       # docs/design.md primitives
    │   ├── features/            # onboarding、overview、issues、performance、apis、usage
    │   └── lib/                 # API client、auth、filters
    ├── services/
    │   ├── api/cmd/api/
    │   ├── ingest/cmd/ingest/
    │   ├── consumer/cmd/consumer/
    │   └── worker/cmd/worker/
    ├── internal/
    │   ├── auth/ config/ event/ fingerprint/ privacy/
    │   ├── metadata/ query/ ingest/ notify/ sourcemap/
    │   └── httpx/
    ├── packages/
    │   ├── browser-sdk/
    │   ├── design-tokens/       # light/dark 语义变量唯一来源
    │   ├── ui/                  # 跨 Web/Site 共享 shadcn primitives
    │   ├── react-sdk/
    │   ├── protocol/
    │   └── vite-plugin/
    ├── migrations/postgres/
    ├── migrations/clickhouse/
    ├── deploy/compose/
    ├── deploy/helm/openrum/
    ├── examples/react-vite/
    ├── tests/e2e/ tests/load/ tests/fixtures/
    ├── docs/
    ├── Makefile
    ├── go.work
    └── pnpm-workspace.yaml

### Infrastructure & Deployment

开发使用 Compose；staging/production 使用 Helm，允许复用公司已有 PostgreSQL、Kafka、ClickHouse、Redis 和 OSS。Ingest 初始 3 replicas、PDB minAvailable=2；Consumer 按 Kafka lag 扩缩且副本数不超过 partitions；API/Worker 初始 2 replicas。

生产参考：Kafka 3 brokers、12 partitions、replication factor 3、min.insync.replicas=2；ClickHouse POC 1 shard × 2 replicas，生产拓扑由 3× 峰值压测决定；PostgreSQL 开启 PITR；Ingress 分离 console/API 与 ingest 域名。

CI：lint → unit test → protocol compatibility → build → integration test → SDK size budget → image scan → staging smoke。迁移使用显式 Kubernetes Job，失败时停止发布。

### Security Considerations

- Argon2id 密码；登录按 IP + account 限流。
- 256-bit 随机会话，数据库只存哈希；登录后 30 天绝对过期、30 天空闲过期。
- 状态变更校验 Origin 与 CSRF token。
- owner/admin/member/viewer RBAC 在 API 服务端强制。
- Browser SDK 对外只接收一个 DSN；DSN 内的项目 write key 只允许 ingest，可轮换/吊销。作为浏览器公开凭证，其明文与校验哈希同时保存，授权用户可随时复制。
- 批次上限：100 events、压缩前 1 MB、压缩后 256 KB，并限制解压比。
- schema 限制嵌套深度、字符串/数组/attributes 数量；未知字段丢弃。
- 服务端二次脱敏；Source Map bucket 私有，预签名 URL ≤ 15 分钟。
- 日志不打印 key、Cookie、query 或 payload；Webhook 防 SSRF。
- 自监控排除 OpenRUM 自身 endpoint，防止递归。

### Cost Estimate

价格依赖公司阿里云折扣与复用资源，验收以内部账单为准。规划模型：

| Stage      | Capacity                         | Resource assumption                         | Planning range                                 |
| ---------- | -------------------------------- | ------------------------------------------- | ---------------------------------------------- |
| Dev        | synthetic                        | laptop Compose                              | 无新增云成本                                   |
| POC        | ≤ 100 万 events/day，7 天        | 复用中间件，应用 4–8 vCPU                   | 新增计算/OSS 目标 ¥0–1,500/月                  |
| Pilot      | 1,000–5,000 万 events/day，14 天 | 应用 16–32 vCPU；CH 1×2 起；Kafka 3 brokers | 以 7 天双写账单估算                            |
| Production | 千万级 PV 对应事件               | 3× 峰值压测定容                             | 由压测、保留策略和基础设施单价形成公开容量档位 |

容量公式：daily_events = PV × events_per_PV × sample_rate；hot_storage = daily_events × compressed_event_bytes × retention_days × replication_factor × 1.3；required_eps = peak_PV_per_second × events_per_PV × sample_rate × 3。

## 3. Data Model

### Entity Definitions

PostgreSQL 控制面实体：

| Table                 | Required fields and rules                                                                                                                                                                          |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| users                 | id UUID PK；email CITEXT unique；display_name varchar(120)；password_hash nullable for OIDC；status active/disabled；auth_source local/oidc；oidc_subject；timestamps                              |
| organizations         | id；name；slug unique；created_by；timestamps                                                                                                                                                      |
| organization_members  | organization_id + user_id composite PK；role owner/admin/member/viewer                                                                                                                             |
| projects              | id；organization_id；name；slug；allowed_origins text[]；environment；retention_days 1–90 default 14；event_sample_rate default 1；api_sample_rate default .2；error_sample_rate default 1；status |
| project_keys          | id；project_id；key_prefix；key_hash unique；name；last_used_at；revoked_at                                                                                                                        |
| sessions              | id；user_id；token_hash unique；ip_hash；user_agent；expires_at；idle_expires_at；revoked_at                                                                                                       |
| releases              | id；project_id；version；dist；commit_sha；deployed_at；unique(project_id,version,dist)                                                                                                            |
| sourcemap_artifacts   | id；release_id；artifact_name；oss_key unique；sha256；size_bytes ≤ 1 GiB；status pending/ready/failed；error_message                                                                              |
| issue_states          | project_id + fingerprint PK；status unresolved/resolved/ignored；assignee；resolved_in_release                                                                                                     |
| alert_rules           | id；project_id；metric；operator；threshold；window_minutes；cooldown；filters JSONB；enabled                                                                                                      |
| notification_channels | id；organization_id；type smtp/webhook；name；config_encrypted；enabled                                                                                                                            |
| alert_rule_channels   | alert_rule_id + channel_id composite PK                                                                                                                                                            |
| audit_logs            | bigint id；organization_id；actor；action；resource_type/id；bounded metadata JSONB；created_at                                                                                                    |
| instance_members      | user_id PK；role instance_owner/instance_admin；created_by；timestamps；至少保留一名 instance_owner                                                                                                |
| instance_settings     | namespace + key PK；非敏感 value_json；version；source；updated_by；timestamps                                                                                                                     |
| instance_secrets      | key PK；ciphertext/nonce/key_version；fingerprint；rotated_at；updated_by；仅在显式启用托管 Secret 时使用                                                                                          |
| retention_policies    | scope_type/scope_id；raw_days；aggregate_days；sourcemap_days；继承关系；version；timestamps                                                                                                       |
| maintenance_jobs      | id；type；status；progress；bounded payload/error；created_by；started_at；finished_at                                                                                                             |
| instance_audit_logs   | bigint id；actor；action；resource_type/id；不含 Secret 的变更摘要；request_id；created_at                                                                                                         |

ClickHouse 原始表 rum_events：

| Field group   | Fields                                                                                                 |
| ------------- | ------------------------------------------------------------------------------------------------------ |
| Identity      | project_id UUID, event_id UUID, event_type LowCardinality(String), timestamp/received_at DateTime64(3) |
| Scope         | environment, release, dist, session_id, anonymous_user_id, user_id, page_id                            |
| Page          | page_url, page_url_normalized, route, referrer, title                                                  |
| SDK/device    | sdk_name/version, schema_version, sample_rate, browser/version, os, device_type, country               |
| Trace         | trace_id, span_id                                                                                      |
| Error         | error_type/message/stack, fingerprint, handled                                                         |
| API/resource  | api_method, api_url_normalized, api_status, duration_ms, transfer_size                                 |
| Metric/custom | metric_name/value/rating, custom_name, attributes Map(String,String)                                   |
| Context       | bounded breadcrumbs array, ingest_flags                                                                |

引擎为 ReplicatedReplacingMergeTree(received_at)，以 Event ID 相同的重放数据最终收敛；PARTITION BY (toYYYYMM(timestamp), project_id)；ORDER BY (project_id, event_type, timestamp, event_id)；默认 raw TTL 14 天。生产以 local + Distributed 表部署。精确明细/核账查询使用 `FINAL` 或按 Event ID 去重，近似分析按 Event ID 聚合，禁止任意 attributes 自动升列。

物化视图：

- project_metrics_1m：PV、errors、API volume/failure、Web Vital quantile states。
- issue_metrics_5m：fingerprint、count、uniq users/sessions、first/last seen。
- api_metrics_5m：method + normalized URL、count/failure、duration quantiles。
- usage_daily：project/day/event_type accepted、estimated、bytes。

### Relationships

- Organization 1:N Projects；Organization N:M Users via memberships。
- Project 1:N Keys、Releases、IssueStates、AlertRules。
- Release 1:N SourceMapArtifacts。
- AlertRule N:M NotificationChannel。
- PostgreSQL project.id 与 ClickHouse project_id 为逻辑外键；删除项目先撤销访问，再异步清 ClickHouse/OSS。
- error fingerprint 与 issue_states 逻辑关联；无状态行时默认 unresolved。

### Indexes

PostgreSQL：members(user_id,organization_id)、projects(organization_id,status)、active project_keys(project_id)、active sessions(user_id,expires_at)、releases(project_id,created_at desc)、artifacts(release_id,status)、rules(project_id,enabled)、audit(organization_id,created_at desc)。

ClickHouse 主排序键服务 project + event_type + time；fingerprint 与 api_url_normalized 配 bloom_filter 辅助索引。列表优先物化视图。所有 Explore/明细查询强制 project_id 和时间范围，默认 24 小时，最大 30 天。

## 4. API Specification

### API Design Philosophy

控制面/查询使用 REST JSON /api/v1；SDK 使用独立 /ingest/v1/envelope。控制台用 Cookie + CSRF，SDK 用项目公钥 + Origin。错误格式：

    {"error":{"code":"VALIDATION_ERROR","message":"说明","requestId":"uuid","details":[]}}

列表使用 opaque cursor；时间序列返回 UTC interval/points；查询必须带 projectId 和 from/to。响应返回 X-Request-Id、X-Query-Duration-Ms、X-Data-Freshness-Seconds。

### Endpoints

Auth/setup：

- GET /api/v1/setup/status → initialized。
- POST /api/v1/setup/bootstrap；空实例且可选 BOOTSTRAP_TOKEN；body email/displayName/password/organizationName；并发仅一条成功。
- POST /api/v1/auth/login；设置 session + csrf cookies。
- POST /api/v1/auth/logout；GET /api/v1/auth/me；POST /api/v1/auth/password。
- GET /api/v1/auth/oidc/start；GET /api/v1/auth/oidc/callback；仅配置后开放。

Organizations/projects：

- GET/POST /api/v1/organizations。
- GET/POST /api/v1/organizations/{orgId}/members；PATCH/DELETE /members/{userId}。
- GET/POST /api/v1/organizations/{orgId}/projects；创建项目时自动生成一个可持续查看的默认客户端 DSN。
- GET/PATCH /api/v1/projects/{projectId}。
- POST /api/v1/projects/{projectId}/keys；DELETE /keys/{keyId}。

Ingest/onboarding：

- POST /ingest/v1/envelope；X-OpenRUM-Key；gzip optional；≤100 events；202 accepted/rejected；207 partial；400/401/403/413/429/503 明确错误。
- POST /api/v1/projects/{projectId}/test-event；生成标记 synthetic events 并走 Kafka。
- GET /api/v1/projects/{projectId}/connection-status → keyConfigured、lastSdkSeenAt、lastEventReceivedAt、lastEventQueryableAt、lastRejectReason。

Queries：

- GET /api/v1/projects/{id}/overview?from&to&environment&release&route → KPIs、comparison、series、topIssues、slowApis、freshness。
- GET /api/v1/projects/{id}/analytics/events?from&to&eventKind&eventName&dimension&environment → 事件目录、趋势、唯一用户/会话、单一受控分群（国家/设备/浏览器/来源/自定义属性）与 freshness；GET /analytics/events/samples 仅允许单一事件与最近 24 小时，最多返回 50 条脱敏样本。
- GET /api/v1/projects/{id}/analytics/sessions?from&to&environment&release&browser&deviceType&country&route&search&signal&sort&minimumEvents&minimumDuration&page → 有界会话列表、异常信号与筛选 facets；GET /analytics/sessions/{sessionId} → 隐私安全行为/错误时间线。
- POST /api/v1/projects/{id}/analytics/funnels/query → 2–5 步漏斗、步骤转化、流失和受治理分群；GET /analytics/paths → 固定 2–5 步 Top-N 会话路径；GET /analytics/retention → 4–12 周范围内的自然周 cohort。
- GET /api/v1/projects/{id}/issues?...；GET/PATCH /issues/{fingerprint}；GET /issues/{fingerprint}/events；GET /events/{eventId}。
- GET /api/v1/projects/{id}/performance/pages；GET /performance/pages/detail?route=...。
- GET /api/v1/projects/{id}/apis；GET /apis/detail?method&url...。
- GET /api/v1/projects/{id}/usage?from&to。

Releases/Source Maps：

- POST /api/v1/projects/{id}/releases。
- POST /api/v1/projects/{id}/releases/{releaseId}/artifacts/presign → uploadUrl/headers/expiresAt。
- POST .../artifacts/{artifactId}/complete；GET artifacts；DELETE artifact。
- POST /api/v1/projects/{id}/sourcemaps/test；body release/dist/file/line/column；返回 matched/source/reason。

Alerts/settings：

- GET/POST /api/v1/projects/{id}/alert-rules；PATCH/DELETE /alert-rules/{ruleId}。
- GET/POST /api/v1/organizations/{orgId}/notification-channels；POST /channels/{id}/test。
- GET /api/v1/projects/{id}/audit-logs；owner/admin。

Instance administration：

- GET /api/v1/admin/overview；实例版本、依赖健康、数据新鲜度、容量和失败任务。
- GET /api/v1/admin/configuration；返回生效值、配置来源和是否被部署锁定，不返回 Secret。
- GET/PATCH /api/v1/admin/retention-policy；POST /retention-policy/preview；POST /retention-jobs。
- GET/PATCH /api/v1/admin/object-storage；Secret 字段 write-only；POST /object-storage/test。
- GET/PATCH /api/v1/admin/authentication；GET/PATCH /admin/notifications。
- GET/POST/DELETE /api/v1/admin/members；GET /admin/audit-logs；GET /admin/maintenance-jobs。
- 所有 mutation 要求实例角色、CSRF 和审计；Secret/清理操作要求最近五分钟内重新认证。

查询超过扫描/时间预算返回 422 QUERY_TOO_EXPENSIVE，并提示缩短范围或增加过滤。

## 5. User Stories

### Epic: Setup and onboarding

**US-001: 初始化实例**
As a 平台管理员, I want 安全创建第一个 owner 和组织 so that 自部署实例无需外部 IdP 即可使用。

Acceptance Criteria:

- [ ] 空数据库下初始化原子创建 owner、组织和会话。
- [ ] 已初始化后再次调用返回 409，不泄露账号。
- [ ] 并发初始化只有一个成功。

**US-002: 接入首个项目**
As a 前端基础设施工程师, I want 复制 SDK 配置并看到实时连接状态 so that 不查服务端日志也能验证接入。

Acceptance Criteria:

- [ ] 客户端 DSN 可由授权用户持续查看和复制；旧版仅存哈希的 key 轮换后迁移到新模型。
- [ ] 每个项目自动生成一个默认 DSN；普通接入不要求创建 key，多 DSN 管理收进高级设置。
- [ ] 展示 SDK seen、event received、event queryable 时间。
- [ ] Origin、key 或 queue 错误给出可执行修复提示。

### Epic: Behavior analytics and diagnosis

**US-003: 查看数据总览**
As a 产品工程负责人, I want 同时查看访问、关键事件、用户分群和错误影响 so that 能决定先探索行为还是诊断问题。

Acceptance Criteria:

- [ ] 时间、环境、release、route 筛选可通过 URL 分享。
- [ ] KPI 带上一周期对比、样本数和 freshness。
- [ ] 点击异常指标进入已过滤的明细。

**US-011: 探索行为并建立漏斗**
As a 产品经理, I want 按国家、设备、浏览器、来源和自定义属性分析事件与漏斗 so that 能理解用户在哪里流失。

Acceptance Criteria:

- [x] 事件趋势展示次数、唯一用户、唯一会话与 Top 属性，筛选可分享。
- [x] 漏斗支持 2–5 个受治理事件步骤、时间窗口和分群，明确统计口径。
- [ ] 点击异常分群可进入对应会话列表，不需要复制筛选条件。

**US-012: 从行为进入错误上下文**
As a 产品工程师, I want 从异常分群或漏斗流失进入行为时间线与关联错误 so that 不切换工具即可形成工程线索。

Acceptance Criteria:

- [x] 时间线按时间显示页面、导航、点击、自定义事件、错误和请求，不采集原始输入值。
- [x] 行为视图可进入错误详情，错误详情可返回关联会话与受影响行为。
- [x] 用户、会话、版本和筛选上下文在页面间保持一致。

**US-004: 处理错误分组**
As a 前端负责人, I want 重复错误按稳定指纹聚合 so that 噪声不会掩盖高影响问题。

Acceptance Criteria:

- [ ] Issue 显示事件数、受影响用户/会话、first/last seen 和趋势。
- [ ] resolve/ignore/assign 持久化并记录审计。
- [ ] 指纹算法版本化，旧链接仍可访问。

**US-005: 从压缩堆栈到源码**
As a 业务前端开发者, I want 把生产错误映射到正确 release 的源码 so that 可以立即开始修复。

Acceptance Criteria:

- [ ] 显示 mapped frame，同时可切换 original frame。
- [ ] project/release/dist/artifact 精确匹配，歧义时不猜测。
- [ ] 缺失/损坏 Source Map 显示有限原因和修复动作。

### Epic: Performance and APIs

**US-006: 找到慢页面**
As a 前端负责人, I want 按 route、release 和设备比较 Web Vitals so that 区分普遍回归与少数慢样本。

Acceptance Criteria:

- [ ] 路由列表显示 PV、P75 指标和样本数。
- [ ] 详情显示趋势、分布、维度与样本。
- [ ] 样本少于 75 明确标注数据不足。

**US-007: 找到慢或失败 API**
As a 业务前端开发者, I want 查看归一化 endpoint 指标和样本 so that 动态 URL 不会碎片化。

Acceptance Criteria:

- [ ] 按 method + normalized URL 展示 count、failure 和 P50/P75/P95。
- [ ] query、body、Cookie 和敏感 header 永不展示。
- [ ] 无法归一化的 URL 进入有界 fallback 分组并标记。

### Epic: Governance and operations

**US-008: 控制采样与保留**
As a 前端基础设施工程师, I want 调整采样/保留并预览数据量影响 so that 自部署容量保持安全可预测。

Acceptance Criteria:

- [ ] 配置五分钟内到达 SDK，并记录生效时间和审计。
- [ ] Usage 区分 estimated、accepted、sampled、rejected、failed。
- [ ] 配置服务失败时 SDK 使用带过期时间的安全缓存。

**US-009: 收到可行动告警**
As a 前端负责人, I want 阈值异常通过 Webhook/邮件通知 so that 可直接进入对应调查视图。

Acceptance Criteria:

- [ ] 通知含项目、环境、窗口、当前值、阈值和 deep link。
- [ ] cooldown 去重但保留持续 breach 记录。
- [ ] 通知失败异步重试，不阻塞 ingest。

**US-010: 判断 OpenRUM 是否健康**
As a 平台工程师, I want Prometheus 指标和 freshness so that 能区分业务平静与管道故障。

Acceptance Criteria:

- [ ] 监控 rate/errors/duration、Kafka lag、CH insert errors、data freshness。
- [ ] reject/drop labels 有界。
- [ ] ClickHouse 故障时 Kafka 保留数据，UI 标记延迟。

**US-013: 安全管理自部署实例**
As a 实例管理员, I want 在独立系统管理中心查看依赖健康、设置数据生命周期并验证 OSS so that 不修改业务项目也能安全维护 OpenRUM。

Acceptance Criteria:

- [ ] 实例角色与组织角色分离，Organization Admin 不能访问系统管理 API。
- [ ] 配置显示最终值及来源；环境变量/Kubernetes Secret 管理的字段只读。
- [ ] 缩短保留时间先预览影响并进入可追踪、可限速的后台任务。
- [ ] OSS 凭证永不回显，连接测试覆盖写入、读取校验和测试对象删除。

### Epic: Open-source adoption

**US-014: 从公共站理解并开始使用 OpenRUM**
As a 第一次到访的前端负责人, I want 快速理解行为分析与错误调查如何连在一起并进入 Quickstart so that 我能判断 OpenRUM 是否值得自部署验证。

Acceptance Criteria:

- [ ] 首页在首屏说明开源、自部署、行为分析 + 错误监控，不暗示付费 SaaS 或未实现能力。
- [ ] 快速开始和 GitHub 两个入口明确，并保留语言、主题和当前内容上下文。
- [ ] 产品声明链接到对应文档、Release 或可复现 benchmark，能力状态可辨认。

**US-015: 独立完成接入和自部署**
As a 开源采用者或 Instance Administrator, I want 从任务导向文档找到 SDK、部署、配置、升级和排障步骤 so that 我不依赖作者即可运行和维护实例。

Acceptance Criteria:

- [ ] Quickstart 和关键代码示例由 CI smoke test 验证，文档标记适用 Release。
- [ ] 搜索、本地目录、前后页导航、复制代码和 Edit on GitHub 可用。
- [ ] SDK Reference、配置和 Helm Reference 从事实源生成或由 drift check 保护。

## 6. Functional Requirements

### Authentication and tenancy

**FR-001: Instance bootstrap**
Priority: P0
Description: 空实例原子创建首个 owner/organization，可选一次性 BOOTSTRAP_TOKEN。
Acceptance Criteria:

- 并发仅一条成功；成功后永久关闭 bootstrap。
- token 常量时间比较；操作产生审计记录。
  Related Stories: US-001

**FR-002: Local auth and sessions**
Priority: P0
Description: 邮箱/密码、Argon2id、可撤销服务端会话与安全 Cookie。
Acceptance Criteria:

- IP + account 双限流；空闲/绝对过期。
- 密码变更撤销其他会话。
  Related Stories: US-001

**FR-003: Organization/project RBAC**
Priority: P0
Description: owner/admin/member/viewer 权限由每个 API 服务端执行。
Acceptance Criteria:

- 跨组织资源不泄露；最后 owner 不可移除。
- 所有关键 mutation 记录审计。
  Related Stories: US-001, US-008

**FR-004: Optional OIDC**
Priority: P1
Description: 配置一个 OIDC provider，使用 authorization code + PKCE。
Acceptance Criteria:

- 校验 state/nonce/PKCE；subject 唯一映射。
- OIDC 故障不影响本地 owner 登录。
  Related Stories: US-001

### SDK and ingest

**FR-005: Browser SDK core**
Priority: P0
Description: 自动采 page_view、error、unhandledrejection、Web Vitals、fetch/XHR 摘要并共享 session/page context。
Acceptance Criteria:

- core gzip ≤ 30 KB；SDK 异常不传播给宿主。
- 默认排除 query/body/Cookie/Authorization。
  Related Stories: US-002, US-003, US-006, US-007

**FR-006: Transport and sampling**
Priority: P0
Description: batching、sendBeacon/fetch keepalive、可选 gzip、瞬时错误重试和确定性采样。
Acceptance Criteria:

- batch ≤100 events/256 KB compressed/1 MB raw。
- 遵循 Retry-After，错误采样可高于 API/资源。
  Related Stories: US-002, US-008

**FR-007: Custom report API**
Priority: P0
Description: captureEvent、setUser、setTag、addBreadcrumb，属性有界且脱敏。
Acceptance Criteria:

- name ≤80；attributes ≤20；key ≤64；value ≤512。
- 保留字段不可覆盖，非法值本地丢弃并计数。
  Related Stories: US-002, US-008

**FR-008: Durable ingest**
Priority: P0
Description: 校验 key、Origin、quota、schema，Kafka 确认后才接受。
Acceptance Criteria:

- 支持单批部分拒绝；queue failure 返回 503。
- 每种拒绝原因进入 Prometheus/Usage。
  Related Stories: US-002, US-010

**FR-009: Normalize and scrub**
Priority: P0
Description: Consumer 将当前/上一协议转 canonical event，归一化 URL、脱敏、计算指纹。
Acceptance Criteria:

- 未知字段丢弃；坏事件进入有界 DLQ。
- 单坏事件不阻塞批次。
  Related Stories: US-007, US-010

### Analysis

**FR-010: Quality overview**
Priority: P0
Description: PV、近似 UV、error/API failure rate、LCP/INP/CLS P75、趋势、top issues/APIs。
Acceptance Criteria:

- freshness P95 <60s；指标显示分母/样本。
- 筛选 URL 化并传递给 drill-down。
  Related Stories: US-003

**FR-011: Fingerprint and issue list**
Priority: P0
Description: 用版本化 exception type、message template、in-app frames 稳定聚合。
Acceptance Criteria:

- 固定 fixtures 保证确定性；用户 fingerprint 有界。
- 列表读取聚合而非扫描 raw。
  Related Stories: US-004

**FR-012: Event detail**
Priority: P0
Description: 展示脱敏 context、stack、breadcrumb、环境、伪名用户/会话、页面和关联 API。
Acceptance Criteria:

- API 永不返回敏感字段。
- 缺失上下文标记 unavailable/sampled。
  Related Stories: US-004, US-005

**FR-013: Source Map lifecycle**
Priority: P0
Description: release 创建、OSS presign、checksum/size 校验、artifact index 和 frame mapping。
Acceptance Criteria:

- artifact 不可从控制台下载；精确匹配。
- 失败原因来自有限枚举。
  Related Stories: US-005

**FR-014: Page performance**
Priority: P0
Description: 按 route/environment/release/browser/device 聚合 Web Vitals 并提供样本。
Acceptance Criteria:

- P75 使用可合并 quantile state；样本 <75 标记不足。
- 查询最大 30 天。
  Related Stories: US-006

**FR-015: API monitoring**
Priority: P0
Description: method + normalized URL 的 volume、failure、duration percentiles。
Acceptance Criteria:

- network/5xx 为默认 failure，4xx 单列；排除 self-ingest。
- 动态路径优先 SDK route hint，再服务端 fallback。
  Related Stories: US-007

**FR-021: Behavior event exploration**
Priority: P0
Description: 对 page_view、navigation、click 和 custom event 提供趋势、唯一用户/会话、国家/设备/浏览器/来源及受治理自定义属性分群。
Acceptance Criteria:

- 所有查询强制 project/time，并限制维度数、属性基数、扫描量与返回行数。
- 筛选与分组写入 URL；响应包含样本数、近似口径和 freshness。
  Related Stories: US-003, US-011

**FR-022: Bounded funnels**
Priority: P0
Description: 支持 2–5 个事件步骤、固定转化窗口和一个分群维度的漏斗查询。
Acceptance Criteria:

- 计算基于伪名用户或会话且明确口径；高成本查询返回 QUERY_TOO_EXPENSIVE。
- 每一步可下钻到受权限保护的会话样本，不能暴露输入内容或未授权身份。
  Related Stories: US-011

**FR-023: Unified behavior and error context**
Priority: P0
Description: 会话时间线统一展示隐私安全的页面、导航、点击、自定义事件、错误和请求，并支持行为与 Issue 双向跳转。
Acceptance Criteria:

- 点击仅记录受治理目标描述，不记录输入值、文本内容或敏感 selector。
- 时间线缺口、采样和乱序必须明确标记；错误/行为链接保留项目与筛选上下文。
  Related Stories: US-004, US-012

### Governance and operations

**FR-016: Sampling and retention**
Priority: P0
Description: project event/API sample rate、1–90 天 retention、安全 emergency sampling。
Acceptance Criteria:

- SDK config cache ≤5min；保存前预估影响。
- 服务端应急采样必须对用户可见。
  Related Stories: US-008

**FR-017: Usage accounting**
Priority: P0
Description: 按日/type 展示 accepted、estimated、rejected、sampled、failed 和 bytes。
Acceptance Criteria:

- 与 Kafka/CH 指标误差 ±2%；drop reason 有界。
- 当前范围可 CSV 导出。
  Related Stories: US-008, US-010

**FR-018: Threshold alerts**
Priority: P1
Description: 固定窗口指标规则，SMTP/Webhook，cooldown 和 deep link。
Acceptance Criteria:

- evaluation 幂等并 leader-elected；secret 加密。
- 通知失败重试且不阻塞数据链路。
  Related Stories: US-009

**FR-019: Self observability**
Priority: P0
Description: Prometheus、health、structured logs、隔离 OpenRUM 项目和 runbook。
Acceptance Criteria:

- labels 有界并含 freshness；自 endpoint 排除。
- 每个 critical alert 有诊断步骤。
  Related Stories: US-010

**FR-020: Kubernetes deployment**
Priority: P0
Description: 提供 stateless 服务 Helm chart 和外部依赖配置。
Acceptance Criteria:

- 支持现有 PG/CH/Kafka/Redis/OSS。
- Secret 只引用不提交；滚动升级/迁移回退完成 smoke。
  Related Stories: US-010

**FR-024: Instance administration and configuration precedence**
Priority: P0
Description: 提供 instance_owner/instance_admin、独立 `/admin` 控制面，以及部署锁定值 → 实例默认 → 项目覆盖的确定性配置优先级。
Acceptance Criteria:

- 首个 bootstrap 用户成为 Instance Owner；最后一名 Owner 不可移除或降级。
- Organization Owner/Admin 不自动获得实例权限；服务端逐 API 鉴权。
- GET 响应标记 effective value/source/locked/version；更新使用乐观锁并产生无 Secret 审计。
  Related Stories: US-001, US-010, US-013

**FR-025: Enforced data lifecycle**
Priority: P0
Description: 实例设置 raw/aggregate/Source Map 默认保留策略，项目可在实例边界内覆盖；策略必须驱动 ClickHouse/OSS 的实际物理过期。
Acceptance Criteria:

- Consumer 写入 `raw_expires_at`/`aggregate_expires_at`，ClickHouse TTL 不再固定为单一全局天数。
- 修改默认只影响新数据；应用到历史数据必须预览、重新认证并创建限速幂等任务。
- 延长策略明确不能恢复已删除数据；清理失败可重试并输出 drift/进度指标。
  Related Stories: US-008, US-010, US-013

**FR-026: Object storage administration**
Priority: P0
Description: 展示可选 Alibaba OSS / S3-compatible Provider、配置来源、脱敏身份、Bucket/Prefix 和连通性；无 Bucket 时核心监控继续运行。
Acceptance Criteria:

- 环境管理的 Secret 只读；API 永不返回 Secret，日志/审计/指标不得包含凭证。
- 连接测试依次验证认证、Bucket、写入、读取和删除，并使用隔离 Prefix。
- 控制台托管 Secret 为显式 opt-in，要求外部 `OPENRUM_MASTER_KEY`、AEAD 加密和原子轮换。
  Related Stories: US-005, US-010, US-013

**FR-027: Instance health, jobs and diagnostics**
Priority: P1
Description: 系统管理概览展示服务/依赖状态、数据新鲜度、Kafka lag、容量、迁移与维护任务，并可导出脱敏诊断包。
Acceptance Criteria:

- 依赖故障显示影响和 runbook，不从 UI 直接重启或扩缩 Kubernetes。
- 诊断包清除 Cookie、Token、DSN、Key 和业务事件内容。
- 后台任务具有等待/运行/完成/部分失败/取消状态及可重试语义。
  Related Stories: US-010, US-013

### Public website and documentation

**FR-028: Public product website**
Priority: P0
Description: 提供与认证控制台解耦的静态公共站，清楚表达开源自部署定位、统一行为/错误调查路径、能力边界和可信证据。
Acceptance Criteria:

- 首页、Product、Self-host 和 Community 页面响应式支持 light/dark，并使用 `packages/design-tokens` 与 `packages/ui`，遵守 `docs/design.md` 的 shadcn contract。
- Primary CTA 进入 Quickstart，Secondary CTA 进入 GitHub；不得出现未提供的在线演示、云托管注册或价格承诺。
- 产品能力声明链接到文档、Release、benchmark 或明确状态；公共站后端不可用时仍可完整浏览。
  Related Stories: US-014

**FR-029: Version-aware documentation experience**
Priority: P0
Description: 在 `/docs` 提供任务导向、可搜索、支持核心页面中英文的 SDK、产品、自部署、运维和 Reference 文档。
Acceptance Criteria:

- 文档使用 `CONTEXT.md` 术语，显示适用 Release；缺失翻译明确回退英文。
- Quickstart、代码示例、内部链接和生成 Reference 在 CI 中验证，构建失败阻止发布。
- 搜索在本地静态索引完成；不将搜索词发送给第三方。
  Related Stories: US-015

**FR-030: Reproducible public evidence**
Priority: P1
Description: 本地 Demo 数据、截图、容量结果和兼容性声明来自可重复生成的版本化来源，而不是手工营销资产。
Acceptance Criteria:

- 本地 Demo 标明数据时间、重置方式、测试账号和推荐调查路径。
- Benchmark 公布环境、数据集、方法、结果、已知限制和复现命令。
- 产品截图或演示数据可由固定 seed 与脚本重新生成，不含真实用户或 Secret。
  Related Stories: US-014, US-015

## 7. Non-Functional Requirements

### Performance

- Ingest（含 Kafka ack）同地域 P95 <100 ms、P99 <250 ms。
- overview/list P95 <2s，detail P95 <3s，hard timeout 10s。
- 接受到可查询 P95 <60s、P99 <180s。
- Console LCP <2.5s、INP <200ms P75；首路由 JS gzip <250KB，chart lazy load。
- SDK core gzip ≤30KB；sync init P75 <10ms；无新增 ≥50ms Long Task。
- 公共 Landing 移动端 LCP <2.5s、INP <200ms、CLS <0.1；静态内容不依赖 API 水合。

### Security

- OWASP Top 10 纳入 threat model；critical dependency/container CVE 阻断发布。
- Session idle 30min、absolute 12h，登录/提权后 rotation。
- Login：5 failures/account/15min、30/IP/15min 后渐进 cooldown。
- TLS 1.2+；secret 来自 Kubernetes/external secret。
- PII scrub 覆盖 URL/header/user/breadcrumb/custom attribute；不支持 body。

### Accessibility

- 核心流程 WCAG 2.1 AA；键盘可操作且 focus 可见。
- Chart 提供文字摘要/表格替代，不只靠颜色表达。
- login/onboarding/overview/issues/settings 自动 axe 无 critical violation。

### Scalability

- 基线持续 10,000 accepted events/s，30,000 events/s 持续 5 分钟无丢失。
- 3× burst 后 15 分钟内 Kafka lag 恢复至 <1min。
- Stateless 服务水平扩展；正确性不依赖内存状态。
- CH 查询强制 project/time，配置 read rows/bytes limit 和 noisy-neighbor quota。

### Reliability

- 月度目标：Ingest 99.9%，Console/API 99.5%。
- Kafka production retention ≥72h。
- PostgreSQL RPO ≤5min、RTO ≤60min，季度恢复演练。
- At-least-once，event_id 处理关键聚合去重。
- CH 故障排队并标 stale；Redis 故障保守降级；通知失败不阻塞 ingest。

## 8. UI/UX Requirements

> Visual tokens are not yet defined. Run the Design System skill with image references to generate docs/design.md before implementation begins.

全局使用组织/项目选择器、左侧导航、顶部时间/环境/release 筛选。一级产品导航固定为：数据大盘、分析、错误、性能、事件、API、告警、会话、设置。数据大盘是登录后的落地页，根路径、项目切换器与接入向导的「进入数据大盘」都指向它。探索作为会话页内的高级筛选能力；洞察保留给未来系统自动发现。接入、发布、用量与项目设置放入视觉上次一级的项目管理区。

### Screen: Instance Setup

Route: /setup
Purpose: 初始化首个 owner/组织。
Layout: 单列表单，说明仅执行一次。
States: Empty=form；Loading=锁提交；Populated=跳项目创建；Error=字段错误或 request ID。
Key Interactions: bootstrap 原子创建并建立 session；已初始化跳 /login。
Components Used: form, input, password-input, button, alert.

### Screen: Login

Route: /login
Purpose: 本地登录和可选 OIDC。
Layout: 登录卡片。
States: Empty=form；Loading=disabled；Populated=安全 returnTo；Error=通用凭证错误/重试时间。
Key Interactions: login → Cookie；OIDC → authorization redirect。
Components Used: form, input, button, alert.

### Screen: Project Onboarding

Route: /projects/:projectId/onboarding
Purpose: 创建项目、复制 SDK、验证管道。
Layout: 四步进度 + code block + live status。
States: Empty=project form；Loading=status skeleton；Populated=四段状态；Error=区分 key/origin/network/queue。
Key Interactions: one-time key copy；test event；queryable 后进 Overview。
Components Used: stepper, code-copy, status-list, button, alert.

### Screen: Data Overview

Route: /projects/:projectId/overview
Purpose: 同时理解用户行为和错误影响，并选择分析或诊断路径。
Layout: filters、PV/UV/事件/错误 KPI、访问与事件趋势、Top 页面/来源/国家/设备/浏览器、top issues。
States: Empty=connect CTA；Loading=stable skeleton；Populated=含 freshness；Error=panel 独立失败/stale banner。
Key Interactions: filters 更新 URL；KPI/chart/row 下钻。
Components Used: filter-bar, metric-card, chart, data-table, freshness-badge.

### Screen: Analytics

Route: /projects/:projectId/analytics；/analytics/funnels；/analytics/sessions/:sessionId
Purpose: 探索事件和分群、建立基础漏斗，并下钻到会话/错误上下文。
Layout: event selector、trend、dimension breakdown、filter builder、funnel steps、session timeline。
States: Empty=事件接入示例；Loading=稳定骨架；Populated=次数/用户/会话与口径；Error=查询预算或隐私限制说明。
Key Interactions: 选择国家/设备/浏览器/来源/自定义属性；2–5 步漏斗；分群/步骤 → 会话 → Issue/Source Map。
Components Used: event-picker, filter-builder, chart, breakdown-table, funnel, session-timeline, privacy-badge.

### Screen: Sessions

Route: /projects/:projectId/sessions；独立调查页 /projects/:projectId/sessions/:sessionId；旧 /insights 重定向至会话页。
Purpose: 浏览全部有界 Session，并从用户旅程、环境、地域、设备、错误、API 和 Web Vital 信号进入调查。
Layout: 搜索与时间/信号筛选、可展开高级 facets、本页摘要、高密度会话表、右侧快速预览 Drawer；独立详情页使用全宽统一时间线和粘性事件检查器。
States: Empty=扩大范围/清除筛选；Loading=稳定表格骨架；Populated=会话摘要与时间线；Error=保留筛选并重试。
Key Interactions: Session ID/用户/路由搜索；国家/设备/浏览器/release/信号/时长筛选；行点击快速预览；会话 → 可分享的完整事件时间线 → Issue/源码；时间线每次游标加载 100 条。
Components Used: input, select, badge, table, drawer, card, toggle-group, pagination, session-timeline, event-inspector.

### Screen: Issues

Route: /projects/:projectId/issues
Purpose: 按影响浏览错误组。
Layout: filters、status tabs、cursor table。
States: Empty=无错误或过滤过窄；Loading=table skeleton；Populated=impact/trend；Error=保留筛选重试。
Key Interactions: row → detail；返回恢复 cursor/filter。
Components Used: tabs, table, badge, sparkline, pagination.

### Screen: Issue Detail

Route: /projects/:projectId/issues/:fingerprint
Purpose: 到达可分派线索。
Layout: issue header/actions、trend/facets、stack、context/breadcrumbs、samples。
States: Empty=扩大时间；Loading=skeleton；Populated=mapped frames；Error=Source Map 与 query 错误分离。
Key Interactions: resolve/ignore/assign；frame source context；copy deep link。
Components Used: issue-header, chart, stack-trace, breadcrumbs, drawer.

### Screen: Performance

Route: /projects/:projectId/performance
Purpose: 比较 route Web Vitals。
Layout: metric selector、trend/distribution、route table。
States: Empty=采集提示；Loading=skeleton；Populated=P75+count；Error=panel retry。
Key Interactions: metric URL 化；route → facets/samples。
Components Used: segmented-control, chart, distribution, table.

### Screen: APIs

Route: /projects/:projectId/apis
Purpose: 查找失败/慢 endpoint。
Layout: filters、summary、endpoint table、detail drawer。
States: Empty=integration hints；Loading=skeleton；Populated=method/url/count/status/P50/P75/P95；Error=query budget guidance。
Key Interactions: server sort；row → trend/status/routes/samples。
Components Used: filter-bar, table, method-badge, chart, drawer.

### Screen: Releases

Route: /projects/:projectId/releases
Purpose: 管理 release/dist、artifacts 和匹配。
Layout: release list、artifact table、upload instructions、match tester。
States: Empty=CLI/Vite quick start；Loading=skeleton；Populated=status/checksum；Error=有限原因。
Key Interactions: upload status；test file/line/column；delete confirm。
Components Used: table, code-copy, status-badge, form, dialog.

### Screen: Usage

Route: /projects/:projectId/usage
Purpose: 解释事件、采样、丢弃和存储。
Layout: estimated/accepted KPI、daily chart、type/drop tables、sampling form。
States: Empty=live counters；Loading=skeleton；Populated=methodology；Error=标数据源。
Key Interactions: 改采样先 preview；CSV export。
Components Used: metric-card, stacked-chart, table, impact-preview, dialog.

### Screen: Alerts and Settings

Route: /projects/:projectId/alerts；/projects/:projectId/settings；/organizations/:orgId/settings
Purpose: 规则、通知、成员、key、Origin、OIDC。
Layout: list/editor 或 section navigation；危险操作隔离。
States: Empty=recommended rules；Loading=skeleton；Populated=current config；Error=不回显 secret。
Key Interactions: test channel；rotate key one-time reveal；last-owner guard。
Components Used: table, drawer, form, switch, secret-reveal, dialog, toast.

### Screen: System Administration

Route: `/admin`；`/admin/data-retention`；`/admin/object-storage`；`/admin/authentication`；`/admin/notifications`；`/admin/maintenance`
Purpose: 让实例管理员安全管理自部署实例，而不混入组织/项目设置。
Layout: 独立 section navigation；概览使用健康/容量卡片；配置页显示 effective value、source、locked 和 last changed；危险操作独立区域。
States: Empty=未配置依赖和修复指引；Loading=稳定骨架；Populated=健康、来源和任务状态；Error=保留已知状态并显示 request ID/runbook。
Key Interactions: retention impact preview → re-auth → async job；OSS connection test；write-only Secret rotation；instance member guard；diagnostics export。
Components Used: health-card, source-badge, policy-form, impact-preview, secret-input, test-result, job-table, audit-table, re-auth-dialog, danger-dialog.

### Screen: Public Website

Route: `/`；`/product`；`/self-host`；`/benchmarks`；`/community`
Purpose: 建立开源自部署产品心智，让访客进入 Quickstart 或 GitHub。
Layout: 公共顶栏、Hero、统一调查路径、能力证据、部署/社区入口、简洁页脚；不复用认证控制台导航。
States: Static=所有核心叙事可用；documentation unavailable=保留本地安装命令和 GitHub 入口；translation fallback=明确标记英文原文。
Key Interactions: 语言/主题切换；行为 → Session → Issue 演示路径；CTA；能力状态和证据链接。
Components Used: public-header, hero, investigation-flow, feature-section, evidence-card, deployment-tier, cta-group, public-footer.

### Screen: Documentation

Route: `/docs/*`
Purpose: 支持采用者独立完成体验、SDK 接入、自部署、运维和贡献。
Layout: 文档侧栏、面包屑、正文目录、版本提示、前后页与反馈入口。
States: Search empty=建议入口；version mismatch=版本提示；missing translation=英文回退；404=搜索/Quickstart/GitHub 恢复路径。
Key Interactions: 本地搜索、复制代码、标题锚点、语言切换、Edit on GitHub、版本切换或提示。
Components Used: docs-sidebar, docs-search, table-of-contents, version-banner, code-block, callout, pagination, feedback-link.

## 9. Auth Implementation

### Auth Flow

空实例只开放 setup/status 与一次性 bootstrap。Local login 经双维度限流后验证 Argon2id，成功创建并轮换服务端 session；设置 HttpOnly session Cookie 和可读 csrf Cookie。Middleware 加载未撤销/未过期会话，mutation 校验 Origin + X-CSRF-Token；退出撤销当前 session，改密码撤销其他 session。

### Provider Configuration

Local owner 永久保留。密码至少 12 位，不强制复杂组合。OIDC 使用 coreos/go-oidc + x/oauth2，authorization code、PKCE、state、nonce；callback 固定 PUBLIC_BASE_URL/api/v1/auth/oidc/callback。自动建用户默认关闭；开启时必须配置 allowed domains 和 default role=member。

### Protected Routes

Public：/setup、/login、OIDC callback。其余组织/项目页面需认证；settings 根据 role 隐藏操作，但服务端仍逐 API 鉴权。Go middleware 顺序：request ID → recovery → headers/body limit → session → CSRF → RBAC → handler → audit。

### User Session Management

Token 为随机 selector+secret，数据库仅存 SHA-256 hash；登录、OIDC callback、提权后 rotation。前端 GET /auth/me 初始化；mutation 遇 401 不自动重试，保留 same-origin returnTo 并跳登录，提示“登录已过期，请重新登录”。

### Role-Based Access

| Action                    | Owner | Admin | Member | Viewer |
| ------------------------- | ----: | ----: | -----: | -----: |
| Read dashboard/event      |   yes |   yes |    yes |    yes |
| Resolve/assign issue      |   yes |   yes |    yes |     no |
| Manage keys/sampling      |   yes |   yes |     no |     no |
| Manage alert rules        |   yes |   yes |    yes |     no |
| Manage members/channels   |   yes |   yes |     no |     no |
| Configure OIDC/delete org |   yes |    no |     no |     no |

组织角色不授予 `/admin` 权限。实例级操作只允许独立的 Instance Owner/Admin；Instance Owner 才能管理实例成员和托管 Secret 策略。

## 10. Payment Integration

收入模型为 free，MVP 不包含支付、订阅、许可证或功能门控，也不产生实现任务。未来若做托管商业版，需另行设计商业模型和多租户隔离，不能直接把 Usage 当账单系统。

## 11. Edge Cases & Error Handling

### Feature: SDK and ingest

| Scenario            | Expected Behavior                                  | Priority |
| ------------------- | -------------------------------------------------- | -------- |
| SDK 内部异常        | 捕获并本地计数，绝不抛给宿主                       | P0       |
| 离线/页面关闭       | 有界缓冲；优先 sendBeacon；过期丢弃可计数          | P0       |
| invalid/revoked key | 401 且不泄露项目；SDK 停止盲重试                   | P0       |
| Origin rejected     | 403 有界错误码；Onboarding 给修复动作              | P0       |
| oversized/zip bomb  | 分配大内存前 413；计指标                           | P0       |
| Kafka unavailable   | 503 + Retry-After，不声称接受                      | P0       |
| retry duplicate     | event_id 不变，关键聚合去重                        | P0       |
| unknown schema      | 单 item UNSUPPORTED_SCHEMA，支持的 siblings 仍接受 | P0       |

### Feature: Query and overview

| Scenario               | Expected Behavior                         | Priority |
| ---------------------- | ----------------------------------------- | -------- |
| ClickHouse unavailable | 503；UI 显示 last good cache/stale banner | P0       |
| Consumer lag 超 SLO    | 响应返回 freshness，UI 不把旧数据当实时   | P0       |
| Query 超预算           | 取消并 422，建议缩短时间/增加过滤         | P0       |
| No data                | 区分无事件、采样和过滤过窄                | P0       |
| Web Vital 样本少       | 显示 count/insufficient，不给回归结论     | P0       |
| UV identity missing    | 使用 session 近似并说明口径               | P0       |

### Feature: Error and Source Map

| Scenario                     | Expected Behavior                           | Priority |
| ---------------------------- | ------------------------------------------- | -------- |
| Missing release/dist         | 保留 raw stack，显示缺失字段                | P0       |
| Checksum mismatch            | artifact failed，隔离/删除 object，允许重传 | P0       |
| Ambiguous match              | 不猜测；返回 AMBIGUOUS_ARTIFACT             | P0       |
| Corrupt map                  | Worker 隔离失败，raw event 可用             | P0       |
| Fingerprint algorithm update | 算法版本化，旧 issue 链接可解析             | P0       |
| Resolved issue recurs        | 仅按明确 release/time 规则标 regression     | P1       |

### Feature: Auth, config and alerts

| Scenario                        | Expected Behavior                                   | Priority |
| ------------------------------- | --------------------------------------------------- | -------- |
| Session expires during mutation | mutation 前 401，安全保留 returnTo                  | P0       |
| CSRF mismatch                   | 403 CSRF_FAILED                                     | P0       |
| Concurrent bootstrap            | 一条成功，其余 409                                  | P0       |
| Last owner removal              | 409 LAST_OWNER                                      | P0       |
| Redis down                      | 使用缓存配置和保守 per-pod limit，告警 operator     | P0       |
| Webhook private IP/redirect     | scheme/host/IP 每跳校验并由 egress policy 阻断 SSRF | P0       |
| Notification timeout            | 指数退避重试 3 次，标 failed                        | P1       |
| Repeated breach                 | cooldown 通知去重但保留 evaluation history          | P1       |
| Retention shortened             | 先预览影响；默认只影响新数据；历史清理异步限速      | P0       |
| Retention extended              | 明确不能恢复已删除数据                              | P0       |
| OSS credential invalid          | 保留旧生效配置，测试失败不切换                      | P0       |
| OSS test leaves object          | Worker 重试删除并产生不含 object 内容的运维告警     | P0       |
| Managed master key unavailable  | 拒绝解密/更新托管 Secret，环境管理配置继续工作      | P0       |
| Concurrent configuration update | 409 CONFIG_VERSION_CONFLICT，重新加载后再提交       | P0       |

## 12. Dependencies & Integrations

### Core Dependencies

Web（安装最新兼容版本，不固定版本号）：

    react, react-dom, typescript, vite, @vitejs/plugin-react
    @tanstack/react-router, @tanstack/react-query, @tanstack/react-table
    echarts, echarts-for-react
    react-hook-form, zod, @hookform/resolvers
    date-fns, clsx, tailwind-merge, lucide-react

Public site（新增前先验证最新兼容版本）：

    astro, @astrojs/starlight, @astrojs/react, tailwindcss

控制台与公共站统一使用 shadcn/ui Radix Nova、Radix base、Tailwind CSS v4、CSS variables 和 Lucide；组件通过项目 package runner 执行 shadcn CLI 添加或更新。公共站优先静态 HTML，React 仅用于必要的交互 island。文档搜索使用构建时本地索引，不接入第三方搜索服务。

Go：

    github.com/go-chi/chi/v5
    github.com/jackc/pgx/v5
    github.com/ClickHouse/clickhouse-go/v2
    github.com/segmentio/kafka-go
    github.com/redis/go-redis/v9
    github.com/alexedwards/argon2id
    github.com/coreos/go-oidc/v3/oidc
    golang.org/x/oauth2
    github.com/google/uuid
    github.com/prometheus/client_golang
    github.com/rs/zerolog
    github.com/go-playground/validator/v10
    github.com/aliyun/aliyun-oss-go-sdk
    github.com/golang-migrate/migrate/v4

Source Map parser 必须封装在 internal/sourcemap 接口后，通过 fixtures 验证 VLQ、indexed map、sourceRoot 与路径重写；选用维护中的 Go 库后再锁定依赖。SDK runtime 依赖保持最少，Web Vitals 实现可使用 web-vitals 但须满足 size budget。

### Development Dependencies

Web：ESLint、Prettier、Vitest、Testing Library、MSW、Playwright、axe-core、size-limit、tsup。Go：go test、go vet、staticcheck、golangci-lint、testcontainers-go。协议用 JSON Schema fixtures 做 TypeScript/Go 双端兼容测试；k6 负责 ingest/query 压测。

### Third-Party Services

| Service                  | Use                                 | Configuration                   | Failure behavior                      |
| ------------------------ | ----------------------------------- | ------------------------------- | ------------------------------------- |
| Optional object storage  | 私有 Source Map；未来 Replay/冷数据 | OSS 或 S3；优先 workload role   | mapping 不可用，raw error/ingest 继续 |
| SMTP                     | 告警/账号通知                       | SMTP_*                          | 异步重试，不影响 ingest               |
| Generic Webhook          | 告警                                | 加密 URL/secret                 | SSRF 防护、重试、记录失败             |
| Optional OIDC            | 企业登录                            | OIDC_*                          | 本地 owner 登录继续                   |
| Prometheus               | 基础设施指标                        | scrape/ServiceMonitor           | 应用继续，外部 scrape alert           |
| Isolated OpenRUM project | 自身错误与使用分析                  | internal key + endpoint exclude | 永不阻塞，必须 recursion guard        |

不需要支付提供商、托管分析 SDK 或外部错误追踪 SaaS。

## 13. Out of Scope

- **Session Replay：** 录制、遮罩、OSS 分片与播放器是独立子系统；核心管道连续达标四周后于第 3–4 月评估。
- **高级路径/留存与身份合并：** MVP 包含事件探索、基础分群/漏斗和会话时间线，但不做任意路径查询、复杂 cohort、跨设备身份合并或无代码通用 BI。
- **完整分布式追踪：** 只保留 trace_id/span_id 与传播 hook；后端 OpenTelemetry 成熟后再集成。
- **自动发布回归/回滚：** 只支持 release 筛选与基础对比；积累 4–8 周数据后设计。
- **SAML/SCIM/复杂审计导出：** 内部验证以 local + optional OIDC 和四角色为限。
- **Native SDK：** 当前只做 Web/H5。
- **AI 根因分析：** 在事件质量和标注闭环建立前不做。
- **商业托管计费：** 产品保持 free/self-hosted。
- **通用 BI/无代码查询器：** 固定调查路径优先。
- **网页基础设施控制台：** 不在 UI 编辑 PostgreSQL/ClickHouse/Kafka/Redis DSN，不控制 Kubernetes 扩缩、重启或升级。
- **默认网页托管 Secret：** 生产优先 RAM Role/Kubernetes Secret/环境变量；控制台托管必须由部署方显式启用。
- **云托管获客与计费站点：** 公共站仅服务开源采用、文档和社区，不实现注册、订阅、价格或 CRM 流程。
- **首阶段博客/CMS：** 内容随代码评审发布；在稳定内容节奏形成前不引入 CMS。
- **在线演示与 Cloud 入口：** 当前阶段只提供可重复的本地 Demo；未来确定 Cloud 产品后再规划托管演示、账号和隔离模型。

## 14. Open Questions

1. **峰值与事件倍率：** 各事件类型每 PV 产生多少条，五分钟峰均比是多少？默认先以 1% shadow sample 跑一周再定容。
2. **热数据保留：** 14 天是否足够，错误是否需 30 天？默认 raw 14 天、聚合更久，取得真实查询与容量数据后开放差异化。
3. **ClickHouse 拓扑：** 复用现有集群还是 OpenRUM 独占？默认 POC 1 shard × 2 replicas，3× 峰值回放后定生产。
4. **Kafka 公司规范：** 是否有固定 Go client、认证、topic 策略？默认 kafka-go 封装在内部接口，服从内部平台标准。
5. **UV 口径：** 是否能合法提供稳定业务 user ID？默认 first-party anonymous ID，setUser opt-in 且伪名化。
6. **Source Map CI：** 所有项目是否已有 release/dist？默认 Vite plugin 使用 package version + commit，生产允许显式覆盖。
7. **告警边界：** 基础设施告警是否继续归 Prometheus/Alertmanager？推荐是；OpenRUM 负责产品质量告警和诊断 deep link。
8. **数据删除 SLA：** 内部对伪名用户数据有什么要求？默认 raw TTL 14 天，项目删除 24 小时内清理 ClickHouse/OSS。
9. **托管 Secret 模式：** 社区版是否需要默认提供数据库托管凭证？当前决策为默认关闭，仅在外部主密钥和显式开关同时存在时启用。

系统管理的完整权限、页面、Secret 和数据生命周期设计见 `docs/system-administration.md`。

公共产品站、文档信息架构、内容策略和发布质量门槛见 `docs/adr/0002-documentation-is-organised-by-reader-task.md` 与 `docs/design.md`。
