---
title: 行为分析
description: 行为事件模型、每次分析查询依赖的维度与指标，以及决定查询能不能跑的预算。
appliesTo: Alpha
---

行为分析回答的是「用户在这个项目和环境里做了什么」。它和错误监控共用一份数据——这正是重点：
完成转化的那个会话和报错的那个会话，是同一批行。

这页是其余所有内容的地基。看懂之后，去[自定义事件](/zh/docs/product/analytics/custom-events/)
学怎么上报，或者去[漏斗、路径与留存](/zh/docs/product/analytics/explorations/)开始查。

## 行为分析看得见什么

分析读四种**事件类型**，由存储后的事件推导得出，而不是由 SDK 声明：

| 类型 | 来源 | `event_name` |
| --- | --- | --- |
| `page_view` | 导航类型不是 `route_change` 的页面访问 | `page_view` |
| `navigation` | 导航类型是 `route_change` 的页面访问（SPA 路由切换） | `navigation` |
| `click` | 自动采集的 `ui.click` 自定义事件 | `click` |
| `custom` | 其他所有自定义事件 | 你自己的事件名 |

:::caution[错误、Web Vitals 和 API 请求不是行为事件]
行为聚合只由 `page_view` 和 `custom` 两类事件构建。错误、Web Vitals 和 API 请求虽然存在同一张
事件表里，但被排除在行为指标、漏斗、路径和留存之外。这三类请分别通过
[性能](/zh/docs/product/performance/)、[API 监控](/zh/docs/product/api-monitoring/) 和 Issues
去分析。
:::

带 `synthetic` 标记的事件——Demo 种子数据和测试事件——在所有行为查询里都被排除，
所以装了 Demo 数据的实例不会把演示流量当成真实流量报出来。

## 维度

每个行为指标都可以按一个维度拆分：

| 维度 | 取值 | 来源 |
| --- | --- | --- |
| `country` | 国家代码，或 `unknown` | 会话的第一条事件 |
| `device` | `desktop`、`mobile`、`tablet`、`bot`、`unknown` | User-Agent |
| `browser` | 浏览器名，或 `unknown` | User-Agent |
| `source` | 来源域名，或 `direct` | Referrer 域名 |
| `property:<key>` | 你的属性值，或 `(not set)` | 自定义事件的属性 |

`<key>` 必须匹配 `^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$`。

:::note[只有自定义事件的属性会变成 property 维度]
`property:` 维度是从**自定义事件**的 `attributes` 物化出来的。通过 `setTag()` 设置的上下文标签
会以 `tag.<key>` 的形式跟在每条事件上，但**不会**暴露成行为维度——也就是说你现在没法按上下文标签
去拆分页面访问。需要用它分组的话，把值放到自定义事件的属性里。
:::

## 指标

| 指标 | 含义 |
| --- | --- |
| `events` | 去重事件数，近似值（`uniqCombined64`） |
| `estimated` | 按 `1 / 采样率` 加权后的事件数，即估算的真实量 |
| `uniqueUsers` | 去重匿名访客数，近似值 |
| `uniqueSessions` | 去重会话数，近似值 |

所有计数在设计上都是近似的，响应里会带 `approximate: true` 让控制台如实标注。调低过采样率、
想知道真实量级时看 `estimated`；想知道实际存了多少时看 `events`。

## 查询预算

分析类查询在真正执行之前会先估算扫描量，超了就直接拒绝，返回 `422 QUERY_TOO_EXPENSIVE`。

代价随时间范围上升，`property:` 维度是内置的四倍；加过滤则下降。解法通常是这几个之一：

- 缩短时间范围
- 加环境过滤（÷4）
- 加事件类型或事件名过滤（÷4，仅行为查询）
- 把 `property:` 维度换成内置维度

## 接下来

- [自定义事件](/zh/docs/product/analytics/custom-events/) —— 载荷契约和 `ui.click` 保留 schema
- [埋点场景](/zh/docs/product/analytics/instrumentation/) —— 注册、下单、功能采用率、搜索
- [漏斗、路径与留存](/zh/docs/product/analytics/explorations/) —— 三种探索查询和各自的限制
- [和 GA4 的对比](/zh/docs/product/analytics/ga4/) —— 逐条对比，包括缺口

相关：[调查路径](/zh/docs/product/investigation/)、[领域模型](/zh/docs/getting-started/domain-model/)、[Browser SDK](/zh/docs/sdk/browser/)。
