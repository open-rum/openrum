---
title: 对象存储
description: 运维用于 Source Map Artifact 的可选 OSS 或 S3 兼容存储。
---

**负责人：** 存储/平台值班 · **数据分类：** 私有构建产物；签名 URL 与凭据属于 Secret

## 触发条件与影响

关注供应商 API 错误/延迟、Source Map 上传或 Finalize 失败，以及未解析栈帧增长。对象存储
故障不影响原始监控事件写入，但新 Release 无法符号化，项目删除清理也可能延迟。

## 安全处置

1. 记录 Region、Bucket、Endpoint、对象前缀、供应商事故、Worker 错误、凭据到期和策略变更；不得记录签名 URL 或 Access Key。
2. 重复重试放大故障时暂停 Source Map Finalize/Retry Worker，保持错误接收并标记符号化延迟。
3. 与云平台负责人恢复 Endpoint、DNS、IAM 或 KMS。阿里原生 API 使用 `oss`，AWS Signature V4 服务使用 `s3`。
4. 不得将 Bucket 改为公开、关闭加密/版本控制、覆盖不可变 Release 对象或批量删除前缀。

## 恢复与验证

上传带预期 SHA-256 元数据的 Canary，通过 Worker 路径读取后只删除该 Key。逐步恢复 Worker，
验证队列 Artifact Finalize，并确认一个已知压缩栈映射到预期源码。健康保持 30 分钟后关闭事故。

故障期间读取不到 Source Map 的事件不会被保存为永久失败，Worker 会在之后的轮次重试。对受影响的
Release 重新运行 CI 上传是安全的：相同文件会被跳过，新变为可用的 Artifact 会重新还原近 7 天内未还原的错误。

## 供应商与凭据配置

对象存储是可选的。未配置 Bucket 时，事件接收、行为分析、错误、性能、API 监控与告警均可用，
只有 Source Map Artifact 不可用。

- **阿里云：** 设置 `OBJECT_STORAGE_PROVIDER=oss`、Region 和 Bucket。优先使用 ECS/ACK RAM Role；静态 `OSS_ACCESS_KEY_ID` 与 `OSS_ACCESS_KEY_SECRET` 必须一起通过 Kubernetes Secret 或部署环境注入。
- **Amazon S3 与兼容服务：** 设置 `OBJECT_STORAGE_PROVIDER=s3`。MinIO、R2、Ceph 使用自定义 Endpoint，必要时设置 `OBJECT_STORAGE_FORCE_PATH_STYLE=true`。优先使用工作负载身份。
- **权限：** 凭证必须能在该 Bucket 中写入和读取对象（OSS 为 `oss:PutObject`、`oss:GetObject`；S3 为 `s3:PutObject`、`s3:GetObject`）。删除权限（`oss:DeleteObject` / `s3:DeleteObject`）是可选的：没有它时上传和堆栈还原正常，连接测试会通过并给出警告，Console 会提示删除受限；在 OpenRUM 中删除 Artifact、Release 或项目仍会完成，但存储桶中的文件会保留，需要自行清理或配置生命周期规则。连接测试写入的测试文件也可能留在 `openrum-diagnostics/connectivity/` 下。
- 生产自定义 Endpoint 必须使用 HTTPS，且 Host 精确列入 `OPENRUM_OBJECT_STORAGE_ENDPOINT_ALLOWLIST`，防止管理探测成为 SSRF 入口。Console 托管模式中填写的 Endpoint 同样受此约束：不在 Allowlist 中的托管 Endpoint 会在探测发出任何请求前被拒绝。

Console 托管凭据模式还需要 `OPENRUM_ALLOW_MANAGED_SECRETS=true`，以及外部提供、Base64 编码的
32 字节 `OPENRUM_MASTER_KEY`。可用 `openssl rand -base64 32` 生成。Helm 路径将其存入 Kubernetes Secret
或外部 Secret Manager；[单机 Docker 路径](/zh/docs/self-hosting/docker-production/)则保存在权限为 `600` 的私有 `.env.production` 和加密的异机备份中。Console 不会返回 Secret，随机对象写入和读取成功后才保存 AEAD 信封；删除被拒绝不会阻止保存，这一限制会随配置一起保存，所有副本都会显示警告。

轮换前需由 Instance Owner 在五分钟内重新认证。探测或数据库写入失败不会切换当前存储客户端；加密写入成功后才切换到新客户端，且不会保留旧的明文凭据作为回滚值。

存在 Console 托管配置时，它优先于 `OBJECT_STORAGE_*` 环境变量配置。保存配置的 API 副本立即切换；
其他 API 副本和所有 Worker 副本每 30 秒检查一次配置版本，发现变化就重建客户端，因此保存或轮换会在
约 30 秒内同步到所有副本，无需重启。据上传、还原或删除清理判断变更效果前，请至少等待这么久。

Worker 负责还原堆栈、为迟到上传补还原，并在删除 Release 或项目时删除 Artifact，因此它需要与 API
相同的 `OPENRUM_ALLOW_MANAGED_SECRETS=true`、`OPENRUM_MASTER_KEY` 和 `OPENRUM_MASTER_KEY_ID`。
缺少这些变量时，Worker 无法解密托管配置，也无法访问托管 Bucket，而 API 仍会接受上传。

Helm 路径把密钥放在 `existingSecret` 中，键名由 `config.secretKeys.managedSecretsMasterKey` 指定；
Chart 会把它注入包括 Worker 在内的每个 Deployment。启用 `config.managedSecrets.enabled` 却缺少该
Secret 时，服务会在启动时拒绝运行。其他部署方式请确认 Worker 的环境变量中也有这三个变量，而不只是 API。

## Canary 边界

使用 `runbook-canary/<incident-id>/<uuid>.txt` 一类唯一 Key，上传前记录 SHA-256；演练权限只授予
`PutObject`、`GetObject`、`HeadObject` 和该 Key 的 `DeleteObject`。禁止通过修改生产 Bucket ACL、
生命周期或加密策略来测试恢复。
