# OpenRUM 系统管理规划

> 内部 RFC，不发布到文档站。这份文档描述的是尚未成形的实例级管理面规划；一旦某块能力落地，对应内容搬进 `apps/site/src/content/docs/docs/self-hosting/` 下的页面，而不是把整篇发出去。

## 1. 目标与边界

系统管理面向部署和维护 OpenRUM 实例的平台工程师，解决实例级配置、数据生命周期、外部依赖、健康状态和安全审计。它与现有组织/项目设置是不同权限边界。

核心原则：

1. **实例配置、组织配置、项目配置分层。** 系统管理员控制部署上限和基础设施；组织 Owner 管理成员与通知渠道；项目 Admin 管理 SDK Key、Origin、采样和受实例策略约束的数据保留。
2. **Secret 不回显。** UI 只显示来源、掩码、更新时间和测试结果，日志、API、审计记录不得包含 Secret。
3. **环境优先。** Kubernetes Secret、环境变量和阿里云 RAM Role 是默认生产配置来源；控制台不得悄悄覆盖被运维系统管理的值。
4. **危险变更可预览、可审计、异步执行。** 缩短保留时间、切换存储和清理数据必须先显示影响范围，再进入可观察的后台任务。
5. **OpenRUM 不是 Kubernetes 控制台。** 页面展示依赖状态和操作指引，但不直接伸缩、重启或升级集群。

## 2. 权限模型

新增实例级角色，与组织角色完全分离：

| 角色                     | 权限                                                                             |
| ------------------------ | -------------------------------------------------------------------------------- |
| Instance Owner           | 管理实例管理员、所有系统配置、Secret、数据清理和危险操作；实例至少保留一名 Owner |
| Instance Admin           | 查看实例状态，管理保留策略、存储、认证和通知配置；不能移除最后一名 Owner         |
| Organization Owner/Admin | 仅管理所在组织和项目，不可访问系统管理 API                                       |

首次 `/setup` 创建的用户同时成为 Instance Owner 和首个 Organization Owner。系统管理导航只对实例角色显示；所有 API 必须在服务端重新鉴权，隐藏菜单不能作为安全边界。

## 3. 导航与页面结构

Route 前缀统一为 `/admin`，在常规一级导航底部增加仅实例管理员可见的“系统管理”入口。

### 3.1 实例概览 `/admin`

- OpenRUM 版本、部署模式、运行时间和最近升级时间
- API、Ingest、Consumer、Worker、PostgreSQL、ClickHouse、Kafka、Redis、OSS 状态
- 数据新鲜度、Kafka lag、失败任务、磁盘/对象存储用量和容量预警
- 当前配置来源汇总：环境变量锁定、控制台管理、项目覆盖
- 只提供诊断链接和 runbook，不在 UI 中直接重启基础设施

首版实例概览已由 `GET /api/v1/admin/overview` 提供。API、PostgreSQL、ClickHouse 和 Redis
执行有界实时探测；OSS 只返回部署配置状态；最新事件与 ClickHouse 磁盘容量来自只读查询。
Kafka Lag、Worker 心跳和失败维护任务在对应采集能力落地前返回 `null`/“尚未接入”，控制台不会生成
看似真实的占位数字。`/api/v1/auth/me` 仅返回当前用户的实例角色，不返回实例成员列表；控制台据此隐藏
系统管理入口，同时管理 API 始终再次执行服务端实例 RBAC。

### 3.2 数据生命周期 `/admin/data-retention`

- 原始事件默认保留时间：默认 14 天
- 分钟级聚合默认保留时间：默认 90 天
- Source Map 默认保留策略：默认随 Release 删除，也可设置最长天数
- Session Replay 预留独立策略，不能复用事件 TTL
- 实例允许的最小/最大范围，以及项目覆盖列表
- 变更预览：影响项目、预计删除时间范围、估算数据量、是否仅影响新数据
- 后台任务：等待、运行、完成、部分失败、取消；显示下一次清理时间
- “立即清理”属于危险操作，需要重新验证密码、输入实例名称并产生审计记录

### 3.3 对象存储 `/admin/object-storage`

- Provider：Alibaba OSS 原生协议，或 Amazon S3 / MinIO / R2 / Ceph 等 S3-compatible 服务
- Region、Endpoint、Bucket、Prefix 和服务端加密方式
- 凭证来源：RAM Role、Kubernetes Secret、环境变量或控制台托管
- Access Key ID 仅显示掩码；Access Key Secret 为 write-only
- 连通性测试分解为：身份验证、列举/定位 Bucket、写入测试对象、读取校验、删除测试对象
- 展示最近成功时间、耗时、错误分类和修复建议
- Source Map、Replay、附件和冷数据使用独立 Prefix，方便生命周期和权限隔离

对象存储是可选能力。未配置时，事件采集、PV/UV、行为分析、错误、性能、API 和告警继续工作；Source Map 上传/源码还原和未来 Session Replay 大对象不可用。生产默认推荐 RAM Role、IAM/Workload Role 或 Kubernetes Secret。首版 UI 对环境管理的凭证只读；只有显式设置 `OPENRUM_ALLOW_MANAGED_SECRETS=true` 且提供 `OPENRUM_MASTER_KEY` 时，才允许控制台托管 Secret。

对象存储状态、连接测试与可选托管轮换已经落地：

- `GET /api/v1/admin/object-storage` 仅返回 Provider、Region、Bucket、脱敏 Endpoint、凭证来源和掩码身份，不返回 Secret 或完整 Access Key ID。
- `OBJECT_STORAGE_PROVIDER=oss` 使用 Alibaba OSS 原生 SDK，可通过 RAM Role 或成对的 `OSS_ACCESS_KEY_*` 访问。
- `OBJECT_STORAGE_PROVIDER=s3` 使用 AWS Signature V4，覆盖 Amazon S3、MinIO、R2、Ceph 等兼容服务，可通过 IAM/Workload Role 或成对的 `AWS_ACCESS_KEY_*` 访问。
- `POST /api/v1/admin/object-storage/test` 在 `openrum-diagnostics/connectivity/` 下写入随机非业务内容，随后读取校验并始终尝试删除；响应只包含步骤、耗时和有限错误分类。
- 生产 Endpoint 必须使用 HTTPS；Alibaba 官方域名直接允许，其他自定义主机必须列入 `OPENRUM_OBJECT_STORAGE_ENDPOINT_ALLOWLIST`。
- Compose 不再内置 MinIO 或创建 Bucket，由实例管理员选择并配置外部 Provider。
- `PUT /api/v1/admin/object-storage/managed` 仅在部署显式授权时可用。候选凭证先经过隔离探测，成功后使用 AES-GCM 信封加密写入 `instance_secrets`，再原子切换进程内 Storage；读取 API 永不返回凭证明文。

### 3.4 认证与访问 `/admin/authentication`

- 本地登录开关、OIDC Provider、允许域名、默认组织角色
- Instance Owner 列表、最近登录和会话撤销
- Bootstrap 已关闭状态，不提供重新开放按钮
- 修改认证配置需要重新验证当前密码，并保留本地 Owner 应急入口

### 3.5 通知与邮件 `/admin/notifications`

- 全局 SMTP 发件配置和测试邮件
- 平台运维 Webhook/Alertmanager 出口
- 与组织级“产品质量告警渠道”分开，避免项目成员收到基础设施 Secret 或内部拓扑

### 3.6 维护与审计 `/admin/maintenance`

- 数据库迁移版本、待执行/失败后台任务、备份状态和最近恢复演练
- 配置变更审计：操作者、字段、旧/新值摘要、来源、时间、请求 ID
- Secret 变更只记录“已轮换”和 Key 指纹，不记录明文或可逆密文
- 提供诊断信息导出，自动清除 Cookie、Token、DSN、Key 和业务事件内容

## 4. 配置优先级

读取配置时使用固定优先级，并在 UI 明确标记最终来源：

1. 环境变量、Kubernetes Secret、RAM Role 等部署锁定值
2. 控制台保存的实例默认值
3. 组织策略（后续能力）
4. 项目覆盖值

下层只能在上层给定的安全边界内覆盖。例如实例允许原始事件保留 1–90 天，项目可选择 7 天或 30 天，但不能选择 180 天。被环境变量锁定的字段显示“由部署管理”，表单禁用并给出 Helm values/Secret 的修改位置。

### 4.1 首批非 Secret 配置

| Namespace | Key           | 内置默认 | 合法范围 | 部署锁定环境变量                           |
| --------- | ------------- | -------- | -------- | ------------------------------------------ |
| retention | rawDays       | 14       | 1–90     | `OPENRUM_DEFAULT_RAW_RETENTION_DAYS`       |
| retention | aggregateDays | 90       | 1–730    | `OPENRUM_DEFAULT_AGGREGATE_RETENTION_DAYS` |
| retention | sourceMapDays | 0        | 0–3650   | `OPENRUM_DEFAULT_SOURCEMAP_RETENTION_DAYS` |

`sourceMapDays=0` 表示随 Release 删除。API 返回 `effectiveValue`、`source`、`locked`、`version` 和 `updatedAt`。控制台更新必须提交当前 `expectedVersion`；尚未保存的设置使用 `0`，并发或过期写入返回 `409 CONFIG_VERSION_CONFLICT`。部署锁定项返回 `409 CONFIG_DEPLOYMENT_LOCKED`，不会在 PostgreSQL 中创建覆盖值。

### 4.2 ClickHouse 物理保留策略

Consumer 在规范化事件后读取项目有效策略，并把 `raw_expires_at` 与 `aggregate_expires_at` 随事件写入 ClickHouse。`rum_events_local` 按前者执行 TTL；项目、API、错误和行为聚合表通过 Materialized View 继承后者，因此原始事件删除后，聚合仍可在配置的更长窗口内查询。策略按项目缓存 30 秒，PostgreSQL 暂时不可用时不提交 Kafka offset，恢复后可安全重试。

策略变更默认仅作用于缓存刷新后写入的新数据，不会在请求路径上触发大范围历史 mutation。对已有分区应用更短保留期属于危险操作，必须通过保留期预览和后台清理任务执行；该流程在 TASK-090 中实现。`usage_records` 与 `usage_metrics_1h` 是运维计量账本，继续使用独立固定窗口，不随产品分析聚合策略变化。

## 5. Secret 安全设计

控制台托管 Secret 不是默认能力。启用时必须满足：

- `OPENRUM_MASTER_KEY` 仅来自环境或外部 Secret Manager，不进入 PostgreSQL
- 使用带随机 nonce 的 AEAD 信封加密；数据库存储密文、版本、Key 指纹和更新时间
- API 写入字段为 write-only，读取永远返回 `configured/source/lastRotatedAt/fingerprint`
- 更新 OSS 凭证先执行连接测试；探测或持久化失败时继续使用旧配置，成功写入新加密记录后原子切换，进程不保留旧明文凭证作为回滚项
- Secret 不进入结构化日志、错误详情、Prometheus label、审计 metadata 或前端缓存
- 测试 Endpoint 必须通过 URL 校验和出站访问策略，防止 SSRF；私有 OSS Endpoint 使用运维 allowlist

## 6. 数据保留的技术方案

### 6.1 当前状态与剩余缺口

- 新写入事件已按项目有效策略携带原始与聚合到期时间，ClickHouse 不再对产品数据使用统一固定窗口
- 原始事件与产品聚合分别执行 TTL，允许原始明细先删除、长期趋势继续可查
- 修改策略默认只影响缓存刷新后的新事件，已有分区不会在请求链路中自动 mutation
- 历史数据变更预览、限速清理任务和对应 UI 已实现，并显示逐批进度与有限错误摘要

下一步重点是安全地把策略应用到已有数据，而不是再次改动在线写入链路。

### 6.2 推荐实现

1. PostgreSQL 新增实例保留策略，项目保留时间改为继承或显式覆盖。
2. Consumer 获取带版本和 TTL 的项目配置，并为每个事件写入 `raw_expires_at` 与 `aggregate_expires_at`。
3. 原始表使用 `TTL raw_expires_at DELETE`；各物化聚合携带 `aggregate_expires_at` 并使用对应 TTL。
4. Source Map 由 Worker 按 Release/独立策略删除，OSS Lifecycle 作为兜底而非唯一真相来源。
5. 修改策略默认只影响新事件；选择“应用到已有数据”时创建异步 `retention_change_job`，分项目、分月份执行并限速。
6. 缩短策略先停止新增长保留数据，再执行历史清理；延长策略无法恢复已删除数据，UI 必须明确提示。
7. Worker 定期核对 PostgreSQL 策略、ClickHouse 最老/最新数据和 OSS 对象，输出 drift 指标。

大项目禁止频繁执行无界 `ALTER DELETE`。历史清理优先利用 `(toYYYYMM(timestamp), project_id)` 分区删除完整月份；边界月份使用限速 mutation，并展示预计完成时间。

### 6.3 历史策略应用

历史数据清理已通过维护任务实现：

1. `POST /api/v1/admin/retention-policy/preview` 校验目标值必须等于项目当前有效策略，并按项目、表和月份估算受影响行数与立即删除行数。
2. 预览返回 10 分钟有效的 `orrp_` opaque token；PostgreSQL 只保存 SHA-256，不保存可重放的明文 token。
3. `POST /api/v1/admin/retention-jobs` 仅允许 Instance Owner 调用，必须验证当前本地密码并建立最长五分钟的 session elevation；token 与操作者绑定且只能消费一次。
4. Worker 每次只领取一个项目/表/月步骤。PostgreSQL advisory lock、运行中步骤保护和五秒全局冷却共同限制多副本并发 mutation。
5. 每一步先删除按新策略已经到期的行，再更新仍应保留行的到期时间。条件式 mutation 可安全重复，失败自动指数退避，最多尝试八次。
6. `GET /api/v1/admin/maintenance-jobs` 返回总步骤、完成步骤、尝试次数、状态和有限错误摘要；任务创建与完成写入不含密码和 token 的审计记录。

预览查询有五秒服务端上限，避免管理操作长期占用 ClickHouse。延长保留期只更新仍存在的数据，任何已经删除的数据都无法恢复。

## 7. 控制面数据模型

建议新增 PostgreSQL 实体：

| Table                 | 用途                                                                     |
| --------------------- | ------------------------------------------------------------------------ |
| `instance_members`    | user_id、role(instance_owner/instance_admin)、created_by、timestamps     |
| `instance_settings`   | namespace、key、非敏感 value_json、version、source、updated_by           |
| `instance_secrets`    | key、ciphertext、nonce、key_version、fingerprint、rotated_at、updated_by |
| `retention_policies`  | scope、raw_days、aggregate_days、sourcemap_days、允许范围、version       |
| `maintenance_jobs`    | type、status、progress、payload 摘要、error_code、started/finished_at    |
| `instance_audit_logs` | actor、action、resource、变更摘要、request_id、created_at                |

Secret 与非敏感设置分表，避免普通配置读取路径意外加载密文。所有更新使用乐观版本控制，冲突返回 `409 CONFIG_VERSION_CONFLICT`。

## 8. API 草案

- `GET /api/v1/admin/overview`
- `GET /api/v1/admin/configuration`
- `GET/PATCH /api/v1/admin/retention-policy`
- `POST /api/v1/admin/retention-policy/preview`
- `POST /api/v1/admin/retention-jobs`
- `GET /api/v1/admin/maintenance-jobs`
- `GET /api/v1/admin/object-storage`
- `POST /api/v1/admin/object-storage/test`
- `PUT /api/v1/admin/object-storage/managed`
- `GET/PATCH /api/v1/admin/authentication`
- `GET/PATCH /api/v1/admin/notifications`
- `GET/POST/DELETE /api/v1/admin/members`
- `GET /api/v1/admin/audit-logs`
- `POST /api/v1/admin/diagnostics/export`

所有 mutation 需要 Session、CSRF、实例角色和审计。Secret/危险操作额外要求最近五分钟内重新认证；预览接口返回 opaque change token，真正执行时必须携带该 token，防止影响范围在确认后发生变化。

控制台在修改实例保留策略或轮换托管对象存储凭证前调用 `POST /api/v1/auth/reauthenticate`，随后服务端仍会在实际 mutation 入口检查同一 Session 的 `elevated_at`。实例成员增删、角色修改、实例配置更新和托管存储轮换都拒绝缺失或超过五分钟的 elevation；仅调用重新认证接口不能绕过实例 RBAC、CSRF 或审计。

`GET /api/v1/admin/audit-logs` 返回最近的 Instance 变更记录。每条记录包含操作人、Request ID、资源路径、配置来源和不含请求体的变更摘要；密码、预览 token、Access Key 和加密信封都不会进入审计表。

## 9. MVP 范围与顺序

### P0：可安全运行

1. 实例角色与服务端 RBAC
2. 系统管理 Shell 和只读健康概览
3. 配置来源/锁定状态模型
4. 真正生效的数据保留策略、预览和异步任务
5. OSS 配置状态、RAM Role/环境凭证识别和连通性测试
6. 实例审计日志与危险操作重新认证

### P1：降低运维门槛

1. 可选的加密托管 OSS Secret 与安全轮换
2. OIDC、SMTP 和平台运维通知配置
3. 备份/迁移/清理任务状态与脱敏诊断包

### P2：规模化治理

1. 组织级策略模板和项目批量覆盖
2. 数据冷热分层、归档和成本预测
3. 外部 Secret Manager 动态同步

## 10. 验收标准

- 非实例管理员访问任何 `/api/v1/admin/*` 均返回 403，不能通过组织 Admin 权限绕过
- 环境管理的 Secret 不可在 UI 修改，任何 API 响应和日志均不包含明文
- OSS 测试对象始终位于专用 Prefix，成功或失败后都会尝试删除
- 原始事件与聚合数据按项目策略过期，测试时钟下误差不超过一个清理周期
- 缩短保留时间前显示影响范围，执行过程可追踪，失败可重试且不重复删除
- 延长保留时间明确说明不能恢复已删除数据
- 最后一名 Instance Owner 不可删除或降级
- 所有配置和危险操作产生不含 Secret 的实例审计记录
- ClickHouse、OSS 或 Worker 故障不会阻断 Ingest；UI 显示延迟和可执行的修复建议

## 11. 明确不做

- 在网页中编辑 PostgreSQL、ClickHouse、Kafka 或 Redis DSN/密码
- 在网页中控制 Kubernetes 扩缩容、重启、升级或节点维护
- 回显、下载或导出任何 Secret
- 把 Prometheus/Alertmanager 全部功能重新实现一遍
- 在没有预览、审计和限速的情况下执行全实例数据清理
