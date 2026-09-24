---
title: 速率限制
description: 配置项目上报上限，理解 429 响应，并运维基于 Redis 的限流保护。
appliesTo: Alpha
---

OpenRUM 在 Ingest 边缘执行速率限制，避免一次流量突增耗尽整个自托管 Instance。主要产品控制项是 **Project Rate Limit（项目速率限制）**：同一个 Project 的所有 DSN 和 Environment 共享一个每秒请求边界。

打开**项目设置 → 数据管理 → 速率限制**，可以查看当前生效值、设置项目覆盖值并选择超限策略。Owner 和 Admin 可以保存，其他项目角色只能查看。

## 统计的是什么

上限按 HTTP Ingest 请求计数，不按 Event 计数。一个请求最多可以携带 100 个 Event，因此 5,000 请求/秒不等于系统经过验证能处理 500,000 Event/秒。真实容量还取决于请求大小、Kafka 确认延迟、Consumer 吞吐和 ClickHouse 写入。

同一 Project 下的所有 DSN 和 Environment 共用这个上限。这让 Project 继续作为 Alpha 阶段的运维与成本边界，但也意味着嘈杂的测试 Environment 可能消耗生产所需的余量。

## 两层保护

| 层级               |    当前默认值 | 范围              | 执行时机                               |
| ------------------ | ------------: | ----------------- | -------------------------------------- |
| 边缘 IP 限制       | 1,000 请求/秒 | 解析后的客户端 IP | DSN 鉴权之前                           |
| Project Rate Limit | 5,000 请求/秒 | 一个 Project      | DSN 和 Origin 检查之后、读取请求体之前 |

Project 覆盖值可设置为 1–1,000,000 请求/秒。清除覆盖值后，Project 会重新继承控制台展示的 Instance 默认值。

IP 层不是 Project 设置，因为执行到这里时系统还不知道请求属于哪个 Project。在 Kubernetes Ingress 或其他反向代理之后部署时，必须配置受信任代理 CIDR，否则所有浏览器都会被当成网关的同一个 IP。参见 [Kubernetes 与 Helm](/zh/docs/self-hosting/kubernetes/)。

## 选择超限策略

### 精确拒绝

一秒窗口内先到的请求会通过，达到上限后的请求返回 `429`。它能精确守住上限，但突发流量可能截断正在进行的 Session，使会话数据不完整。

### 按调用方稳定降采样

超限请求按稳定的调用方哈希取舍。一个调用方倾向于整体通过或整体拒绝，因此更容易保留完整 Session，比例指标也更可比。代价是上限变为近似值：单个窗口最多可能放行配置值的两倍。

这属于过载保护，不是日常流量的 SDK 采样。常规 Event 和 API Request 采样应在**数据管理**下相邻的**采样配置**标签中设置，调整后的实际量级可以在**用量统计**查看。

## HTTP 响应约定

超限请求返回：

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 1
X-OpenRUM-RateLimit-Scope: project
X-OpenRUM-RateLimit-Limit: 5000
```

`X-OpenRUM-RateLimit-Scope` 取值为 `ip` 或 `project`，Limit 响应头表示本次作出决定的上限。Project 限流响应通过 CORS 暴露这些响应头，便于浏览器诊断；发生在鉴权前的 IP 拒绝没有可信 Project 上下文，不一定能向页面开放 CORS 读取权限。

Browser SDK 会把收到 `429` 的批次留在队列里，并按照 `Retry-After` 延迟重试。重试队列能缓解短暂突发，但它不是无限存储，也不能保证持续过载时不丢数据。长期出现 429 时，应修复流量来源或扩容经过验证的系统能力。

## Redis 与多个 Ingest 副本

Redis 可用时，所有 Ingest 副本共享固定的一秒计数器。Redis 不可用时，每个进程退化为本地计数，并按配置上限的一半独立保护自己。此时每个进程仍受保护，但 Instance 总上限不再精确，而且会随副本数变化。

Redis 故障应视为限流能力降级。按照 [Redis 运维手册](/zh/docs/self-hosting/redis/)恢复后，重新验证 IP 与 Project 两层限制。

## 估算 Project 上限

从生产形态的测量开始，不要使用 Demo 流量推算：

```text
所需请求速率 = 峰值 Event/秒 ÷ 平均每请求 Event 数
配置上限 = 所需请求速率 ÷ 目标利用率
```

例如峰值为 24,000 Event/秒、平均每请求 8 个 Event，则需要 3,000 请求/秒。若目标利用率为 75%，可从约 4,000 请求/秒开始压测。这个数字只是压测输入，不是 OpenRUM 发布的容量结论。还要为断线重连和 Release 发布突发保留余量，并结合[容量规划](/zh/docs/self-hosting/capacity/)验证。

## 持续出现 429 时

1. 读取 `X-OpenRUM-RateLimit-Scope` 和请求的 `X-Request-ID`。
2. 如果是 `ip`，检查受信任代理配置，并确认是否有大量调用方被折叠到同一个地址。
3. 如果是 `project`，检查 SDK 是否重复初始化、是否存在重试循环、某个 Environment 是否突然产生噪声，以及平均每请求 Event 数是否下降。
4. 提高上限前，先把配置值与真实 Ingest 和依赖容量对照。
5. Redis 不健康时，先恢复共享计数，再解释集群总速率。

## 当前限制

- 尚未持久化 Project 级限流命中次数和趋势。控制台只能显示最近一次被记录的 Ingest 拒绝是否为限流；现有用量数据不能当作限流次数。
- Instance 的 Project 默认值和边缘 IP 上限仍是代码默认值，不是可编辑的 Instance Setting。
- Environment 之间没有独立预留额度，共享同一个 Project 边界。
- 当前使用固定一秒窗口，没有可配置的突发预算或令牌桶。
- 告警暂时不能按持续限流触发。

相关内容：[项目设置](/zh/docs/product/project-settings/)、[容量规划](/zh/docs/self-hosting/capacity/)、[Redis](/zh/docs/self-hosting/redis/)和[威胁模型](/zh/docs/self-hosting/security/threat-model/)。
