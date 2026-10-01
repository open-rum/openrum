---
title: 故障排查
description: 排查本地启动、事件缺失、登录和 Source Map 问题。
---

**适用于：** Alpha。

## 本地 Compose 无法健康启动

1. 确认 Docker、Compose v2 可用，且 `4173`、`5433`、`8123`、`9000`、`9092`、`6379` 未占用。
2. 查看服务状态：

```sh
docker compose -f deploy/compose/docker-compose.yml ps
docker compose -f deploy/compose/docker-compose.yml logs --tail=100 api ingest consumer worker web
```

3. 在 `deploy/compose/.env` 覆盖冲突端口。
4. 只有明确要清空本地演示数据时才执行 `docker compose -f deploy/compose/docker-compose.yml down -v`。

## Console 可以打开但登录失败

- 使用与 `PUBLIC_BASE_URL` 一致的 `http://127.0.0.1:4173`。
- 运行 `curl --fail http://127.0.0.1:4173/health/ready` 检查 API Readiness。
- 本地演示账号为 `demo@openrum.local` / `OpenRUM-demo-2026!`，仅用于本地评估。

## 事件没有出现

1. 检查 Browser SDK `dsn` 与项目允许的 Origin。
2. 检查 Ingest 日志和项目 Key 的 Origin Allowlist。
3. 确认 Kafka、Consumer 和 ClickHouse 健康；首次启动等待演示数据完成。
4. 在较宽时间范围查看“事件”，再用相同 `session_id` 查看“会话”。

## 调查路径不完整

| 现象 | 可能原因 | 下一步 |
| --- | --- | --- |
| 行为图表为空 | Seed 未完成或 ClickHouse 异常 | 等待并检查 Consumer/ClickHouse |
| 会话没有错误 | 该会话确实无错误事件 | 在演示项目筛选带错误的会话 |
| Issue 无源码栈 | 未配置对象存储，或没有与栈帧匹配的 Artifact | 参见 [Source Map 上传失败](#source-map-上传失败) |
| API 面板为空 | 未捕获 fetch/XHR 或采样关闭 | 从示例应用触发请求 |

## Source Map 上传失败

对象存储是可选的。只有需要还原栈帧时才配置 OSS 或 S3 兼容 Bucket，然后按照 [Source Map](/zh/docs/sdk/source-maps/) 和[对象存储](/zh/docs/self-hosting/object-storage/)操作。

插件和 CLI 会为每个失败的文件输出一行，包含 API 错误码和 Request ID。按下表查找错误码；需要服务端细节时，用 Request ID 搜索 API 和 Worker 日志。

| 错误码 | 含义 | 处理方法 |
| --- | --- | --- |
| `OBJECT_STORAGE_NOT_CONFIGURED`（503） | Instance 没有配置对象存储。插件会停止上传剩余文件。 | 由 Instance 管理员通过环境变量或 **设置 → 系统设置 → 对象存储** 配置 OSS 或 S3，参见[对象存储](/zh/docs/self-hosting/object-storage/)。 |
| `OBJECT_STORAGE_UNAVAILABLE`（503） | 已配置存储，但当前客户端无法使用：凭据错误、Bucket 被删除、网络或 DNS 故障，或供应商故障。插件会重试 2 次。 | 检查 API 日志和供应商状态。Console 托管的配置约 30 秒内同步到所有 API 和 Worker 副本，修改后至少等待这么久再重试。故障处置参见[对象存储运维手册](/zh/docs/self-hosting/object-storage/)。 |
| `ARTIFACT_TOO_LARGE`（400） | 单个 Source Map 超过 64 MiB。插件会在上传前拒绝这类文件。 | 拆分产物，例如使用 `build.rollupOptions.output.manualChunks`，让每个 Source Map 更小。 |
| `ARTIFACT_EXISTS`（409） | 该 Release 已有同名且可用的 Source Map，但内容不同，通常是内容变化的构建沿用了旧 Release 版本号。 | 为变化后的构建使用新 Release。确实需要覆盖时，设置 `replace: true` 或传入 `--replace`。内容相同的重复上传会被跳过，不会触发此错误。 |
| `ARTIFACT_MISMATCH`（422） | 存储中对象的大小或 SHA-256 与插件声明的不一致，例如代理改写了请求体或上传被截断。 | 重新上传。若反复出现，检查 CI Runner 与对象存储之间的代理，以及 Bucket 的转换或压缩设置。 |
| `INVALID_UPLOAD_TOKEN`（401） | 令牌格式错误、不存在或已吊销。 | 在 **设置 → 项目 → 接入指引 → Source Map 上传令牌** 新建令牌，并更新 CI Secret `OPENRUM_UPLOAD_TOKEN`。 |
| `NOT_FOUND`（404） | 项目 ID 错误，或令牌属于另一个项目。 | 使用签发该令牌的项目的 ID。 |

### 上传成功但栈帧仍未还原

从 **错误** 打开该错误，每个未还原的帧都会显示原因：

- **`missing_artifact`** 几乎都是命名不匹配。Artifact 名称必须等于脚本 URL 的路径（去掉协议、域名、查询参数和开头的 `/`）加 `.map`。在 **发布** 页对比栈帧 URL 与该 Release 已上传的名称。站点部署在子路径或 CDN 前缀下时，设置 `urlPrefix` 让名称包含该前缀。可用发布页的匹配测试器检查单个栈帧。
- **`missing_release`** 表示事件没有 `release`，需要在 SDK `init()` 中设置 `release`。
- **`ambiguous_artifact`**，或 Source Map 上传到了另一个 Release：SDK 的 `release` 和 `dist` 必须与插件使用的值完全一致。

缺失的 Artifact 变为可用后，近 7 天内的错误会自动重新还原，因此修复上传也会修复近期事件。

## 仍无法解决

- [容量规划](/zh/docs/self-hosting/capacity/)
- 侧边栏 **依赖 runbook** 下的各依赖运维手册
- 对公网开放 Instance 前阅读[威胁模型](/zh/docs/self-hosting/security/threat-model/)
- 提交仓库 Issue，并附 Compose 状态、Request ID 和脱敏日志
