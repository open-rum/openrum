---
title: Kubernetes 与 Helm 参考
description: 生产 Kubernetes 部署的 Chart 资源、路由、扩缩容、安全与升级参考。
appliesTo: Alpha
---

`deploy/helm/openrum` 下的 Chart 会部署 OpenRUM 的五个工作负载——`api`、`ingest`、`consumer`、`worker` 和 `web`——并带上滚动更新、健康探针、自动扩缩容和一个数据库迁移 Hook。新建 Kubernetes 实例时，请先完成三步[部署生产](/zh/docs/getting-started/production-deployment/)教程；本页只作为配置、安全和日常运营细节的 Chart 参考。

默认情况下它还会为这个 Release 运行一个单实例 Redis（见 [Redis：自带或外部](#redis自带或外部)）。它**不会**帮你创建 PostgreSQL、ClickHouse 或 Kafka，不会创建 Kafka 主题，不会签发 TLS 证书，也不会创建它要读取的 Secret。这些都是前置条件。漏掉 Secret 或两个数据库会让安装直接失败；而漏掉 Kafka 主题则会安装成功、运行时才丢事件，这一种更难被发现。

## 安装前的准备

**自行准备 PostgreSQL、ClickHouse 和 Kafka。** Compose 拓扑只用于本地开发。生产环境请使用托管版或高可用的服务，并决定 Redis 用 Chart 自带的还是你自己的。在承接生产流量前用[容量规划](/zh/docs/self-hosting/capacity/)确定规格。各依赖分别存什么，见[外部依赖](/zh/docs/self-hosting/dependencies/)。

**Kafka 主题必须自己建。** 生产者和消费者都设置了 `AllowAutoTopicCreation: false`，所以主题不存在是一个运行时故障，不会自动恢复。默认主题名是 `rum-events-v1`，并且 ingest 只在 `acks=all` 之后才报告持久化接收成功。

**确保集群能够拉取镜像。** Helm 负责安装 Chart，容器镜像由 Kubernetes 按 Chart 中的地址拉取。Chart 默认使用 `ghcr.io/open-rum/openrum`；只有首个正式版本发布且软件包公开后，这个默认地址才可使用。在此之前，请自行构建并发布镜像，在自己的 values 文件里覆盖 `image.repository`，不要修改 Chart 源文件。

**先定好域名和 TLS 证书。** `config.appEnv: production` 会让所有服务在启动时拒绝非 HTTPS 的 `PUBLIC_BASE_URL`，而 `ingress.tls` 默认是空的——见[路由与 TLS](#路由与-tls)。

Chart 声明了 `kubeVersion: ">=1.28.0-0"`，它使用 `autoscaling/v2` 和 `policy/v1`，因此不支持更旧的集群。

## 1. 创建运行时 Secret

Chart 从不创建这个 Secret，只会引用 `config.existingSecret` 里的名字（默认 `openrum-runtime`）。**必须在 `helm install` 之前建好**，因为迁移 Job 是 `pre-install` Hook，要从里面读两个 DSN。Secret 不存在时，Release 会在任何工作负载被调度之前就失败。

```sh
kubectl -n openrum create secret generic openrum-runtime \
  --from-literal=POSTGRES_DSN='postgres://openrum:...@postgres:5432/openrum?sslmode=require' \
  --from-literal=CLICKHOUSE_DSN='clickhouse://openrum:...@clickhouse:9000/openrum' \
  --from-literal=BOOTSTRAP_TOKEN="$(openssl rand -hex 32)"
```

只有 `POSTGRES_DSN` 和 `CLICKHOUSE_DSN` 是必需的。其余所有键都以 `optional: true` 挂载，也就是可以缺失——这正是 `BOOTSTRAP_TOKEN` 容易被忘掉的原因，而漏掉它的代价见[第 5 步](#5-创建第一个管理员)。

| Secret 键 | 是否必需 | 用途 |
| --- | --- | --- |
| `POSTGRES_DSN` | 是 | 控制平面数据库 |
| `CLICKHOUSE_DSN` | 是 | 事件存储 |
| `BOOTSTRAP_TOKEN` | 强烈建议 | 授权创建第一个管理员 |
| `OSS_ACCESS_KEY_ID`、`OSS_ACCESS_KEY_SECRET` | 仅阿里云 OSS 需要 | Source Map Artifact 存储 |
| `AWS_ACCESS_KEY_ID`、`AWS_SECRET_ACCESS_KEY`、`AWS_SESSION_TOKEN` | 仅 S3 兼容存储需要 | Source Map Artifact 存储 |
| `OPENRUM_MASTER_KEY` | 仅启用托管密钥时需要 | 加密已保存的通知渠道凭据 |

如果你的密钥管理系统有自己的命名规范，键名可以在 `config.secretKeys` 下改。

`OPENRUM_MASTER_KEY` 必须是**恰好 32 字节**的 base64；长度不对会在启动时直接报错，而不是被忽略。它只在 `config.managedSecrets.enabled` 为 `true` 时才会被读取；没有它，用户在 Console 里保存通知渠道会收到 `503 MANAGED_SECRETS_REQUIRED`。

## 2. 写一份 values 文件

把环境配置放进独立文件，不要直接改 Chart。下面这些值需要按你的部署环境填写：

```yaml
config:
  appEnv: production
  publicBaseURL: https://rum.example.com
  kafkaBrokers: kafka-0.kafka:9092,kafka-1.kafka:9092
  existingSecret: openrum-runtime

# 使用 Chart 自带的 Redis 时，删掉这一段即可。
redis:
  mode: external
  external:
    address: redis-master.data:6379

ingress:
  enabled: true
  className: nginx
  host: rum.example.com
  tls:
    - hosts: [rum.example.com]
      secretName: openrum-tls
```

如果使用内网镜像仓库，在这份文件中补上 `image.repository: registry.example.com/openrum` 和 `image.tag: "0.1.0"`，版本应与 Chart 匹配。如果仓库是私有的，先在同一命名空间创建镜像拉取 Secret，再添加 `imagePullSecrets: [{ name: your-registry-secret }]`。Chart 会将其传给业务 Deployment、安装前的迁移 Job 和 Helm 测试 Pod。如果集群也无法拉取默认的 `busybox:1.37` 测试镜像，还需覆盖 `smokeTest.image`。

`publicBaseURL` 必须是绝对的 `http(s)` URL，在 `appEnv: production` 下还必须是 HTTPS。它是 Console 和 SDK 被告知要使用的源，所以必须填用户真正访问的地址，而不是集群内部的 Service 名。

对象存储是可选的，但它是全有或全无：如果你填了 `endpoint`、`bucket`、`region` 中任意一项却把 `provider` 留空，所有 Pod 都会以 `OBJECT_STORAGE_PROVIDER is required when object storage fields are configured` 退出。要么把 `provider` 设为 `oss` 或 `s3`，要么整块留空。见[对象存储](/zh/docs/self-hosting/object-storage/)。

完整的带注释列表是 [Helm values 参考](/zh/docs/reference/helm-values/)，由 `values.yaml` 生成。

### Redis：自带或外部

`redis.mode` 决定 Redis 从哪里来。OpenRUM 在 Redis 里存限流计数、登录节流、大盘缓存和连接进度。这些都不是事实来源，但 Redis 连不上时 API 和 Ingest 会报告未就绪，所以 Redis 的可用性就是它们的可用性。

| 模式 | Chart 做什么 | 适用场景 |
| --- | --- | --- |
| `bundled`（默认） | 以 StatefulSet 运行一个 Redis（`redis:7.2-alpine`），Service 名为 `<release>-openrum-redis`，并把 `REDIS_ADDR` 指向它 | 评估、小规模实例或首次安装 |
| `external` | 不创建 Redis，使用 `redis.external.address`（`host:port`） | 需要高可用的生产环境：使用单一地址、后台自动切换的托管 Redis |

自带 Redis 的默认设置：

- `--maxmemory 192mb`，内存上限 256 MiB，满了按最近最少使用淘汰，与 Compose 拓扑一致。
- 数据只在内存里，重启后为空。设置 `redis.bundled.persistence.enabled: true` 会加上 PersistentVolumeClaim 并开启 AOF 持久化。已有 StatefulSet 的卷模板不能修改，所以之后切换持久化需要先执行 `kubectl delete statefulset <release>-openrum-redis` 再升级；这些数据可以丢弃。
- 一条只允许本 Release 的 Pod 访问的 NetworkPolicy。只有集群网络插件支持 NetworkPolicy 时才生效。
- 使用私有镜像仓库时，同步镜像并设置 `redis.bundled.image.repository`。

自带 Redis 重启时，API 和 Ingest 会有几秒不可用。需要不停机维护时请用 `external`。OpenRUM 目前连接 Redis 不带密码和 TLS，也不支持 Sentinel 或 Cluster 模式，所以外部 Redis 必须能通过一个私网地址访问。

早期 Chart 版本的 `config.redisAddress` 已移除。values 文件里仍然设置它时，渲染会失败，并提示改用 `redis.external.address`。

## 3. 安装

官方 `0.1.0` 版本发布后，可用 OCI Chart 和配套的默认镜像安装：

```sh
helm upgrade --install openrum oci://ghcr.io/open-rum/charts/openrum \
  --version 0.1.0 \
  --namespace openrum --create-namespace \
  --values values.production.yaml \
  --wait --timeout 15m
```

在首个官方版本发布前，把上述 OCI Chart 地址替换为 `deploy/helm/openrum`，并将 `image.repository` 指向你自己发布的镜像。发布 Chart 本身不会将它安装到你的集群。

`pre-install,pre-upgrade` Hook 会执行 `/app/migrate up all`——先 PostgreSQL 迁移，再 ClickHouse——Hook 权重是 `-5`，因此在任何工作负载启动之前 Schema 就已就位。它会重试两次（`migration.backoffLimit`），Job 的截止时间是 600 秒，但二进制自身还有一个两分钟的 context 超时，所以真正耗时很久的迁移会先撞上这个限制。

迁移器在整个过程中持有一个 PostgreSQL advisory lock，因此同时应用两个 Release 会串行执行，而不是互相竞争。

迁移失败会导致整个 Release 失败。这个 Job 会被保留（`hook-delete-policy: before-hook-creation,hook-succeeded`），方便你排查：

```sh
kubectl -n openrum logs -l app.kubernetes.io/component=migration --tail=-1
```

## 4. 验证发布结果

```sh
helm test openrum --namespace openrum
kubectl -n openrum get deploy,hpa,ingress -l app.kubernetes.io/instance=openrum
```

`helm test` 会运行一个 smoke-test Pod，通过 Service 请求 `api`、`ingest` 和 `web` 的存活端点，这验证的是集群内路由是否通，而不只是 Pod 是否 Ready。

每个服务都提供 `/health/ready` 和 `/health/live`；`web` 由前置的 nginx 同时提供这两个端点和一个 `/metrics` 桩。就绪探针每 2 秒轮询一次，存活探针每 20 秒一次，启动探针允许 30 次失败、间隔 2 秒——也就是冷启动大约有一分钟的余量。

## 5. 创建第一个管理员

打开 `https://rum.example.com/setup`，按[首次使用与维护](/zh/docs/getting-started/production-deployment/first-run/)中的管理员初始化步骤和[创建第一个项目](/zh/docs/getting-started/create-first-project/)操作。

### 在 ingress 可被访问之前设置 BOOTSTRAP_TOKEN

**当 `BOOTSTRAP_TOKEN` 为空时，初始化授权会被完全跳过。** 创建第一个用户和组织的端点是 `POST /api/v1/setup/bootstrap`，而 ingress 会把它暴露在 `/api` 前缀下。在一个刚部署、有公网域名又没设 token 的实例上，谁先访问到谁就成了管理员。

设置了 token 之后，请求必须在 `X-OpenRUM-Bootstrap-Token` 请求头里带上它。无论哪种情况，一旦存在任何用户，这个窗口就永久关闭——端点之后会返回 `409 ALREADY_INITIALIZED`。

## Chart 会创建哪些资源

| 资源 | 说明 |
| --- | --- |
| 5 个 Deployment | `maxUnavailable: 0`、`maxSurge: 1`、`minReadySeconds: 5` |
| 5 个 Service | 端口 `80`，转发到各容器端口 |
| Redis 的 StatefulSet、Service 和 NetworkPolicy | 仅在 `redis.mode: bundled` 时创建 |
| 1 个 ConfigMap | 非机密环境变量，其 checksum 会写进 Pod 注解 |
| 1 个 Ingress | 单域名，三条路径规则 |
| 3 个 HorizontalPodAutoscaler | 仅 `api`、`ingest`、`web` |
| PodDisruptionBudget | 仅为副本数大于 1 的服务创建 |
| 迁移 Job | 每个 Release 版本一个，作为安装/升级 Hook |
| ServiceMonitor、PrometheusRule | 默认都关闭 |

由于 ConfigMap 的 checksum 被注解到了每个 Pod 模板上，改动 `config` 下的值会自动触发 Pod 滚动更新。但改动被引用的 Secret **不会**——Kubernetes 没有等价的触发机制，所以轮换凭据时要显式执行 `kubectl rollout restart`。

## 路由与 TLS

Ingress 暴露一个域名和三条前缀规则，按匹配精确度排列如下：

| 路径 | 服务 |
| --- | --- |
| `/api` | `api` |
| `/ingest` | `ingest` |
| `/` | `web`（Console） |

因此浏览器 SDK 的上报流量会发往 `https://<域名>/ingest`，Console 和 SDK 共用 `publicBaseURL` 里的这个源。

**TLS 默认没有配置。** `ingress.tls` 是一个空列表，Chart 既不申请也不引用任何证书。请在 ingress 上终止 TLS：用你自己管理的 Secret 填好 `ingress.tls`；如果你使用自动化的证书控制器，在 `ingress.annotations` 下加上签发者注解。在 `appEnv` 为 `production` 时把这一项留空，会得到一个对外宣称 HTTPS 基址、实际却跑在明文监听上的实例。

## 扩缩容

自动扩缩容默认对 `api`（2–8）、`ingest`（3–20）和 `web`（2–6）开启，CPU 目标除 ingest 是 65% 外都是 70%，扩容稳定窗口 30 秒，缩容 300 秒。

`consumer` 和 `worker` 是刻意不自动扩缩的。消费者的吞吐受 Kafka 分区数和 ClickHouse 写入压力约束，所以要按实测的消费延迟来调整，而不是按 CPU——见 [Kafka](/zh/docs/self-hosting/kafka/)。

`worker` 默认只有一个副本，因为它的两类任务扩展方式不同。告警评估通过 `pg_try_advisory_lock` 做主节点选举，所以永远只有一个副本在评估规则，其余空转。项目删除用 `FOR UPDATE SKIP LOCKED` 领取任务，这部分确实能分散到多个副本。所以增加 worker 换来的是删除吞吐和故障转移，而不是更快的告警。

Chart 的写法带来两个值得知道的后果：

- Deployment 模板每次都会写出 `services.*.replicas`，因此 `helm upgrade` 会把副本数重置为这个静态值，再由 HPA 扩回去。升级期间自动扩缩的服务会有一次短暂的副本下降。
- PodDisruptionBudget 是根据 `services.*.replicas` 生成的，不是根据 HPA 的 `minReplicas`。如果你把某个服务的 `replicas` 降到 1 而依赖 HPA 扩容，这个服务就会静默地失去中断预算。

## 默认的安全加固

所有 Pod 都以 `runAsNonRoot` 运行，根文件系统只读，丢弃全部 capabilities，`allowPrivilegeEscalation: false`，使用 `RuntimeDefault` seccomp 配置，`fsGroup: 65532`。镜像里唯一可写的路径是挂在 `/tmp` 的 128 MiB `emptyDir`，nginx 用它存放自己的临时目录。自带的 Redis 遵守同样的限制，以镜像内的 `redis` 用户（UID 999）运行，只写 `/data`。

正因为根文件系统只读，任何期望在 `/tmp` 之外写入的自定义镜像都会陷入崩溃重启。在把 ingest 暴露到公网之前，请先看[威胁模型](/zh/docs/self-hosting/security/threat-model/)和[隐私](/zh/docs/self-hosting/security/privacy/)。

### 声明你的边缘，否则单 IP 限流会退化成一个总闸

Ingest 默认按 socket 对端限流，因为转发 header 是调用方自己写的：无条件相信它，等于让任何人随意铸造身份、彻底绕过限流器。而在 Ingress 后面，这个对端就是网关，于是所有调用方被压缩到同一个 1000 req/s 的桶里。正常总流量一旦超过阈值就会被随机拒绝，症状看起来只是偶发上报失败，而不像是限流。

把 `config.ingestTrustedProxies` 设为网关 Pod 所在的 CIDR，限流就会改按真实调用方计数：

```yaml
config:
  ingestTrustedProxies: 10.42.0.0/16
```

此后 `X-Forwarded-For` 会被读取，但仅限对端在该列表内的请求，且只取链条右端——也就是你的代理写入的那部分。调用方自行前置塞入的条目会被忽略。这个列表只填你真正在运行的代理：任何能匹配上的一方，都能自行决定被限流的身份。

## 这个 Chart 的局限

以下是真实存在的缺口，不是可以悄悄绕过的疏漏：

- **无法注入任意环境变量。** ConfigMap 模板的键列表是固定的，因此二进制支持但 Chart 没有渲染的配置——`SHUTDOWN_TIMEOUT`、`INGEST_BASE_URL`——无法通过 values 设置。要设置它们只能手动补丁 ConfigMap 或扩展模板。
- **`services.web.port` 实际上改不了。** Chart 把它接到了容器端口和探针上，但 Console 的 nginx 配置硬编码了 `listen 8080`。改了这个值会让 Pod 永远不就绪。
- **只有 Redis 可以自带。** PostgreSQL、ClickHouse 和 Kafka 存放必须保留的数据，Chart 不运行它们。自带的 Redis 是单实例，不是高可用方案。
- **监控集成需要手动开启，且依赖 Prometheus Operator。** `serviceMonitor` 和 `prometheusRules` 渲染的 CRD 必须已经存在于集群中。

## 升级与回滚

`helm upgrade` 会在新 Pod 滚动之前重新执行迁移 Hook。迁移在实践中是单向的：`/app/migrate down` 只接受 `postgres` 这一个目标，所以 `helm rollback` 能回退工作负载和配置，但**不会**回退 Schema。支持的操作顺序见[升级](/zh/docs/self-hosting/upgrades/)；在第一次生产升级之前，请先确认[备份与恢复](/zh/docs/self-hosting/backup-restore/)确实可用。

发布之后出现问题，请从[故障排查](/zh/docs/self-hosting/troubleshooting/)开始。
