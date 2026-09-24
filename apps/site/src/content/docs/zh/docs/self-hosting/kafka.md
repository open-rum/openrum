---
title: Kafka
description: Broker、Lag 或确认失败时的接收缓冲运维指南。
---

**负责人：** 流式平台值班 · **主要保护：** 已确认事件保留在复制的 Kafka 中

## 触发条件与影响

关注 `OpenRUMIngestUnavailable` 和 `OpenRUMKafkaLagHigh`，并检查 Ingest unavailable 比例、
Producer 确认 P99、Consumer Lag、Broker 健康和副本不足分区。Kafka 写失败必须返回非成功，
OpenRUM 不能在 `acks=all` 之前声称耐久接收。

## 安全处置

1. 记录事故时间、告警标签、Helm Revision、Broker/Controller、ISR 与 Topic 磁盘。
2. 仅 Consumer 故障且保留容量充足时可保持 Ingest，停止发布并在已验证范围内扩容 Consumer；不得重置 Offset。
3. Producer 无法耐久确认或保留余量不足时，通过 SDK 远程配置降低采样，必要时再暂停 Ingest；不得伪造成功响应。
4. 修复 Broker、网络或配额；不得删除/重建 Topic，也不得降低复制因子或 min-ISR 来消除告警。

## 恢复与验证

1. 确认每个分区都有 Leader 且 ISR 收敛，生产并消费一个 Canary 信封。
2. 逐步增加 Consumer，观察 Lag 斜率、ClickHouse 插入和数据新鲜度。
3. 对比事故窗口的已接收、已提交和死信计数，解释所有差异。
4. 分阶段恢复采样；错误率和确认 P99 健康 30 分钟后关闭事故。

## 只读证据命令

```sh
kubectl -n <namespace> get deploy,pod -l app.kubernetes.io/instance=<release>
kubectl -n <namespace> logs deploy/<release>-consumer --since=15m
kafka-consumer-groups.sh --bootstrap-server <broker> --group <consumer-group> --describe
kafka-topics.sh --bootstrap-server <broker> --topic rum-events-v1 --describe
```

Offset 重置必须有评审过的回放窗口、当前 Offset 备份和事故负责人明确批准。
