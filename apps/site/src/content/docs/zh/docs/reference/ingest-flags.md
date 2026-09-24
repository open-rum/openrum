---
title: 入库标记
description: OpenRUM 在归一化阶段给事件打上的标记，以及每个标记对数据意味着什么。
appliesTo: Alpha
---

每条入库的事件都带一个 `ingest_flags` 数组。标记记录的是管线对这条事件的观察结果，而不是 SDK 上报的内容本身。标记不会改动事件自身的字段，所以被打了标记的事件依然是完整的。

| 标记 | 何时打上 | 对聚合的影响 |
| --- | --- | --- |
| `synthetic` | 事件来自播种的演示数据或开发数据，而非真实浏览器。 | 排除。所有聚合视图都会过滤掉。 |
| `clock_adjusted` | 上报的时间戳早于 2000 年，或晚于 ingest 收到的时刻 24 小时以上，于是改用入库时间。 | 无。 |
| `pii_scrubbed` | 脱敏改动了至少一个字段——用户标识、标题、属性、错误消息或 breadcrumb。 | 无。 |
| `bot` | User-Agent 表明这是爬虫或无头浏览器。 | 默认没有。项目可以选择丢弃，见[入站过滤](/zh/docs/product/inbound-filters/)。 |

## 查询标记

标记以 `LowCardinality` 数组存储，按它过滤的开销很低：

```sql
SELECT countIf(has(ingest_flags, 'bot')) AS bot_events, count() AS all_events
FROM rum_events
WHERE project_id = {project:UUID} AND event_time >= now() - INTERVAL 7 DAY;
```

## 关于 bot 标记

`bot` 标记 User-Agent 自称为自动化的流量。它在归一化阶段写入，因为那是最后一个还持有原始 User-Agent 的环节——入库的事件只保留解析后的浏览器和操作系统，之后再也无法还原这个区别。

在据此采取行动之前，有两点需要先知道。

**绝大多数爬虫根本不会出现。** 不执行 JavaScript 的爬虫永远不会加载浏览器 SDK，也就不会产生任何事件。链接预览抓取是最典型的例子：它读完页面的 meta 标签就走了。真正能到达 OpenRUM 的是用 Chrome 渲染的 Googlebot，以及无头浏览器。

**无头浏览器会被算作机器人。** 由 Playwright 或 Puppeteer 驱动的端到端测试和合成可用性拨测都会被打上标记。这究竟是噪声还是你真正关心的信号，取决于你用它们做什么。

无论项目怎么处置，这个标记都会被记录。是否据此行动是可选的，按项目在[入站过滤](/zh/docs/product/inbound-filters/)里配置，可以先仅统计、之后再丢弃。运维侧可以通过 `openrum_consumer_filtered_total` 观察实例范围的同类统计，标签为 `reason` 与 `mode`。
