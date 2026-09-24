---
title: 存储压力
description: 在磁盘写满前发现和降载，并通过明确的采样与接入保护安全恢复。
appliesTo: Alpha
---

磁盘写满并不是一种统一故障：ClickHouse 容量不足会让查询数据延迟，Kafka
容量不足会停止 Ingest 的持久化确认，PostgreSQL 容量不足则会中断控制面。
Kafka 未确认写入时，OpenRUM 不会返回伪成功。

## 应安装的告警

在 Helm values 中同时启用 `serviceMonitor` 和 `prometheusRules`。内置规则覆盖：

- 持久卷剩余空间、inode 耗尽、预计写满时间与节点 DiskPressure；
- ClickHouse 容量探测失败与自动保护启用；
- ClickHouse 写入失败和数据新鲜度；
- Kafka Consumer 延迟与按实际保留期计算的剩余缓冲时间。

PVC 规则只覆盖 OpenRUM release 所在 namespace。部署在其他 namespace 或云厂商
中的 PostgreSQL、Kafka、ClickHouse，仍必须配置厂商侧磁盘告警。

## ClickHouse 自动保护

存储压力保护器每 30 秒读取 ClickHouse `system.disks`。磁盘达到 90% 时，
Browser SDK 的事件、错误和 API 采样率会被限制到 10%；达到 95% 时，Ingest
开启硬熔断，不再读取或写入 envelope，而是返回空的 `202` 接收结果。这个明确的
丢弃策略可以避免磁盘满时产生重试风暴。两种保护都要等磁盘降回 90% 以下才解除。

```yaml
config:
  kafkaRetentionDuration: 168h # 必须与真实 topic 保留期一致
  storagePressure:
    guardEnabled: true
    warningFreeRatio: "0.15"
    criticalFreeRatio: "0.10"
    hardStopFreeRatio: "0.05"
    recoveryFreeRatio: "0.10"
    emergencySampleRate: "0.10"
    pollInterval: 30s
serviceMonitor:
  enabled: true
prometheusRules:
  enabled: true
```

ClickHouse 账号必须能读取 `system.disks`。从未进入硬熔断时，探测失败会保持开放，
同时输出 `openrum_storage_capacity_probe_success 0`，Instance 概览也会显示容量未知；
一旦确认进入硬熔断，就必须由成功的容量探测确认恢复后才会重新开放。这项保护不会
自动扩容，也无法保护部署在其他位置的 Kafka 磁盘。

## Console 中的表现

每个 Console 页面顶部都会针对容量偏低、自动降采样和 Ingest 硬熔断显示全局 Banner。
Instance Settings 还会展示 ClickHouse 已用/剩余容量和当前保护状态；Project 页面
继续在数据尚未完成查询入库时显示“数据延迟”。

达到容量阈值后，Instance Owner 可以点击硬熔断 Banner 中的“立即清理旧数据”，或进入
**设置 → 实例 → 数据生命周期 → 紧急存储恢复**：

1. 点击“生成推荐清理方案”。系统自动选择最旧的完整 Project/月数据；不需要执行命令。
2. 检查当前使用率、预计释放空间和清理后使用率。只有已经结束超过 24 小时的完整自然月
   才能被选择；即使本月暂时没有新数据，也不会清理本月。
3. 输入“清理旧数据”和当前密码后确认。页面会持续显示后台任务进度。
4. 成功释放空间后仍由容量保护器重新检测；低于 90% 才自动恢复数据接入。

紧急清理与普通保留期不同：它删除完整 ClickHouse 分区，以避免磁盘已满时执行大范围
数据改写。如果可安全删除的旧月份不足以降到 85%，页面会明确提示仍需扩容。删除不可恢复。

恢复时请遵循 [ClickHouse](/zh/docs/self-hosting/clickhouse/) 和
[Kafka](/zh/docs/self-hosting/kafka/) runbook。不要为了腾空间直接删除数据库文件、
Kafka topic 或 Docker volume。
