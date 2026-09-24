---
title: 项目设置
description: 配置环境、DSN、Origin、采样、保留时间、入站治理和速率限制。
---

**适用版本：** Alpha。状态：Alpha 已实现。

Project 设置决定一个被监控的 Web 产品如何上报和保留遥测数据。

## 设置入口

Console 的设置地址会明确写出作用域：

- **常规**（`/settings/project/<id>/general`）：名称、Slug、Origin、Environment、保留天数、停用/启用和数据清空。
- **接入指引**（`/projects/<id>/onboarding`）：复制项目默认 DSN 和平台接入代码。
- **数据管理**：集中采样、速率限制、入站过滤、URL 归一化和隐私脱敏。通过页内标签切换，各项独立保存，作用于当前项目的全部环境。
- **用量统计**（`/settings/project/<id>/usage`）：查看已接收量、估算原始量、处理结果并导出 CSV；采样配置与报表分开。

### 数据管理分区

| 分区 | 用途 | 地址 |
| --- | --- | --- |
| 采样配置 | 在 SDK 上报前控制行为、API 和错误事件的保留比例，基于最近 7 天全部事件类型预估用量变化。 | `/settings/project/<id>/sampling` |
| 速率限制 | 限制 Ingest 每秒请求数，并选择超限策略；与日常 SDK 采样独立。 | `/settings/project/<id>/quota` |
| 入站过滤 | 排除爬虫、扩展、localhost 和自定义模式。 | `/settings/project/<id>/filters` |
| URL 归一化 | 将动态地址归为稳定的路由模板。 | `/settings/project/<id>/url-rules` |
| 隐私脱敏 | 在内置脱敏规则之上追加敏感字段和匹配模式。 | `/settings/project/<id>/scrubbing` |

用量预估加载失败、暂无数据或明细达到查询上限时，仍可正常配置采样。
**告警**（`/projects/<id>/alerts`）继续保留独立项目导航入口。

原有 `/projects/<id>/settings/…` 链接仍会重定向到对应设置地址；
旧的 `/projects/<id>/usage` 链接会保留时间与事件类型筛选并跳转到用量统计。

## 会立即影响上报的设置

- 移除 Origin 后，Ingest 会拒绝该站点的新报告。
- SDK `init()` 中的 `environment` 必须与 Project 下存在的 Environment 匹配。
- 停用 Project 会拒绝所有新报告，但保留 DSN，适合临时停止噪声项目。

## 清空项目数据

“清空所有项目数据”会永久删除 Event、Session、Issue、Log、API、性能数据、用量聚合、告警历史、Release 和 Source Map，但保留 Project、Environment、DSN、Origin、采样、保留策略、告警规则和审计历史。

为避免数据继续进入：

1. Organization Owner 必须先停用 Project。
2. 输入完整 Project 名称确认。
3. 清空任务排队、执行、重试或验证期间不能重新启用。

任务在分析存储清空后等待一分钟再次验证，Project 不会自动重新启用。

## 归一化与脱敏

URL 规则和自定义脱敏由 Consumer 执行，约 30 秒缓存到期后生效，只影响之后写入的数据。内置隐私规则始终先执行，项目配置不能关闭这个保护下限。URL 规则从上到下匹配，首个匹配项胜出。

## 速率限制

项目速率限制按**每秒请求数**计算，而不是按 Event 数量；一个请求最多可携带 100 个 Event。留空则使用 Instance 默认值。

- **拒绝**：严格限制，超限请求返回 `429`，突发流量可能切断 Session。
- **采样**：按调用方稳定放行或丢弃，使 Session 更完整；上限是近似值。

两种模式都会返回 `429`。完整 Header、Redis 降级和容量计算见[速率限制](/zh/docs/product/rate-limits/)。

相关文档：[创建第一个项目](/zh/docs/getting-started/create-first-project/)、[数据生命周期](/zh/docs/self-hosting/data-lifecycle/)、[隐私](/zh/docs/self-hosting/security/privacy/)。
