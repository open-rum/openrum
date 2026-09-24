---
title: 升级
description: 安全升级 OpenRUM 服务、Schema 与依赖。
---

## 兼容性契约

OpenRUM 在应用 Pod 滚动前，通过 Helm `pre-install,pre-upgrade` Job 执行 PostgreSQL 与
ClickHouse 迁移。常规 Release 的迁移必须 Expand First：只增加列/表，Reader 同时兼容 N-1 与 N；
破坏性清理至少延后一个 Release。

迁移 Job 幂等并受数据库 Advisory Lock 保护；失败会在 Deployment 变化前中止升级。镜像必须提供
`/bin/sh`，五秒 `preStop` 用于端点摘除和在途请求排空。

## N-1 到 N

1. 确认 PostgreSQL/ClickHouse 备份、Kafka Lag、Ingest 接收和查询新鲜度健康。
2. 运行 `helm lint deploy/helm/openrum` 并渲染准确的生产 Values。
3. 执行：

```sh
helm upgrade openrum deploy/helm/openrum --namespace openrum --atomic --wait --timeout 15m -f values.production.yaml
```

4. 确认迁移 Job 完成、所有 Deployment 可用、Kafka Lag 恢复基线且 `helm test openrum --namespace openrum` 成功。
5. 全程保留 SDK 接收探测；接收下降或 P99 超预算时中止。

## 应用回滚

只有目标应用版本明确兼容已应用 Schema 时，才能执行
`helm rollback openrum <revision> --namespace openrum --wait`。Helm 回滚绝不执行数据库 Down Migration。

不要自动逆转迁移；新 Writer 或已存数据可能依赖扩展后的 Schema。不向后兼容的迁移必须使用单独评审的
维护方案、备份检查点和数据丢失评估。

## 迁移失败恢复

- 保留 Job 日志和迁移表状态。
- 优先修复后向前执行；Lock 与版本行会避免重复应用。
- 只有停止全部 Writer 并确认恢复点目标后才能恢复备份；重新开放 Ingest 前核对 Kafka Offset。
