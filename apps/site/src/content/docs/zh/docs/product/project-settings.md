---
title: 项目设置
description: 配置环境、DSN、Source Map 上传令牌、Origin、采样、保留时间、入站治理和速率限制。
---

**适用版本：** Alpha。状态：Alpha 已实现。

Project 设置决定一个被监控的 Web 产品如何上报和保留遥测数据。

## 常用设置

- **环境**：每个 Project 都接收四个固定环境：`development`、`test`、`staging` 和 `production`
- **客户端 DSN**：包含 Origin Allowlist、轮换与吊销
- **采样**：控制 Event、API 请求和错误的采样
- **保留时间**：原始数据与聚合数据的保留期
- **Source Map 上传令牌**：让 CI 为当前项目上传 Source Map Artifact

Release 及其 Source Map Artifact 不属于项目设置，请在项目主导航打开 **发布**（`/projects/<id>/releases`）。

## 设置入口

Console 的设置地址会明确写出作用域：

- **常规**（`/settings/project/<id>/general`）：名称、开发平台、Origin、保留天数、停用/启用和删除项目。
- **接入指引**（`/projects/<id>/onboarding`）：复制项目默认 DSN 和平台接入代码，并管理 **Source Map 上传令牌**。Owner 和 Admin 可以创建和吊销令牌，明文只显示一次。参见 [Release 与 Source Map](/zh/docs/sdk/source-maps/)。
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
- 每个项目自动接收四个固定环境的上报：开发 `development`、测试 `test`、灰度 `staging`、生产 `production`，无需启用。SDK `init()` 的 `environment` 取其一，其他名称会被拒绝。环境切换器列出已有上报数据的环境，分析默认看全部环境。
- 停用 Project 会拒绝所有新报告，但保留 DSN，适合临时停止噪声项目。

## 删除项目

常规页的「删除项目」会永久删除该项目及其全部数据，只有 Organization Owner 可以操作。**按住按钮 2 秒**确认，中途松开不会删除。

- 立即吊销项目的全部 DSN，Ingest 不再接收该项目的上报，项目从列表和切换器中消失。
- 后台任务随后删除 Event、Session、Issue、Log、API、性能数据、用量聚合、告警规则与历史、Release 和 Source Map，并在分析存储清空一分钟后再次确认没有残留。
- 数据库中的项目记录以「删除中」状态保留（软删除），审计历史不受影响，但项目无法恢复。

只想暂停上报时，请使用可随时恢复的「停用项目」。

## 归一化与脱敏

URL 规则和自定义脱敏由 Consumer 执行，约 30 秒缓存到期后生效，只影响之后写入的数据。内置隐私规则始终先执行，项目配置不能关闭这个保护下限。URL 规则从上到下匹配，首个匹配项胜出。

## 速率限制

项目速率限制按**每秒请求数**计算，而不是按 Event 数量；一个请求最多可携带 100 个 Event。留空则使用 Instance 默认值。

- **拒绝**：严格限制，超限请求返回 `429`，突发流量可能切断 Session。
- **采样**：按调用方稳定放行或丢弃，使 Session 更完整；上限是近似值。

两种模式都会返回 `429`。完整 Header、Redis 降级和容量计算见[速率限制](/zh/docs/product/rate-limits/)。

## 运维建议

- `setUser` 优先使用不透明的账号 ID，不要把邮箱作为身份标识。
- 生产环境的 Origin Allowlist 应尽量精确。
- DSN 是浏览器公开的连接串，依靠 Origin 和速率限制保护。
- 只有需要上传 Source Map 时才配置对象存储。
- 每条 CI 流水线使用独立的 Source Map 上传令牌，并吊销不再使用的令牌。

相关文档：[创建第一个项目](/zh/docs/getting-started/create-first-project/)、[数据生命周期](/zh/docs/self-hosting/data-lifecycle/)、[隐私](/zh/docs/self-hosting/security/privacy/)。
