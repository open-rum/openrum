---
title: 数据生命周期
description: 原始遥测与聚合数据的保留、到期和受控清理。
---

OpenRUM 将控制面元数据存储在 PostgreSQL，将遥测与聚合存储在 ClickHouse，将上传的
Source Map Artifact 存储在可选对象存储中。各层必须使用明确且相互一致的保留策略。

## 原则

- 原始事件保留时间应尽可能短，只满足调查和合规需要。
- 聚合数据可以比原始事件保留更久，但不能意外保留可识别属性。
- ClickHouse 使用 TTL 和分区清理，禁止在事故中执行未经评审的大范围 `DELETE`。
- 项目清空与删除任务必须可审计、可重试，并验证 ClickHouse 和对象存储均无残留。
- 备份保留不等同于在线数据保留；恢复流程必须遵守删除和隐私承诺。
- 缩短保留期前先估算合并、磁盘和查询影响，并保留回滚证据。

磁盘压力处置参见[存储压力](/zh/docs/self-hosting/storage-pressure/)，备份边界参见[备份与恢复](/zh/docs/self-hosting/backup-restore/)。
