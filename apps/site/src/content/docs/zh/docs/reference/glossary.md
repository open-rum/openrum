---
title: 术语与核心概念
description: OpenRUM 对 Instance、Organization、Project、Event、Session、Issue、Release 和 Console 等概念使用的统一术语，以及应避免的说法。
appliesTo: Alpha
---

OpenRUM 文档、Console 和 API 共用一套术语，根目录 `CONTEXT.md` 是权威来源。请优先使用这些术语，避免使用列出的同义词。

## 所有权与交付

| 术语 | 含义 | 避免使用 |
| --- | --- | --- |
| **Console** | 经过认证的运维界面，用于查看 Project 的观测数据，并管理 Project、Organization 和 Instance 的配置 | Dashboard、admin panel、back office |
| **Instance** | 一套自托管 OpenRUM 及其全局运维策略边界 | Tenant、cluster、workspace |
| **Instance Administrator** | 独立于 Organization 角色，管理 Instance 配置、数据生命周期、外部依赖和维护的运维人员 | Super admin、organization admin |
| **Organization** | 拥有 Project、成员和访问策略的团队边界 | Tenant、account、workspace |
| **Project** | 作为一个报告边界被监控的 Web 产品，可包含多个 Environment | App、application、service |
| **SDK Platform** | 为 Project 选择的前端框架或工具链，如 JavaScript、React、Vue 或 Next.js。它决定接入指引和 Project 图标，不改变可接收的 Event 类型或 Environment 边界 | Project type、runtime、event platform |
| **Environment** | Project 内的部署范围，如 production、canary、test 或 development | Stage、namespace |
| **Project Settings** | 作用范围是当前所选 Project 的配置与运维工具 | App settings、project management |
| **Project Rate Limit** | 一个 Project 内所有 DSN 和 Environment 共用的每秒请求边界，统计的是 Ingest 请求，而不是其中携带的 Event 数 | Environment quota、event limit、sampling rate |
| **Instance Settings** | 作用范围是整个 Instance 的配置与维护控制，只对 Instance Administrator 可见 | System management、super-admin settings |
| **Release** | 将观测数据关联到一次交付的构建标识 | Version、deployment |

## 观测数据

| 术语 | 含义 | 避免使用 |
| --- | --- | --- |
| **Event** | 在某个时间点采集的不可变观测 | Log、record、message |
| **Log** | 带严重级别、消息和结构化属性的诊断 Event（`type=log`）。由 Browser SDK 的 logger 或选定的 `captureConsole` 方法显式发出，可通过 Session 或传入的 trace 上下文关联。它不会生成 Issue，也不算 Custom Event | Error、Issue、Custom Event |
| **Page View** | 页面或客户端 Route 变为可见时的 Event | Hit、impression |
| **Session** | 将访客 Event 关联为一次旅程的有限活动周期，闲置 30 分钟后结束，连续活动 24 小时后轮换 | Visit、replay |
| **Issue** | 可统一调查和处理的一组等价错误 Event | Error、exception、incident |
| **Fingerprint** | 决定错误归入哪个 Issue 的版本化稳定标识 | Issue ID、hash、signature |
| **Issue State** | Project 维度附加到 Issue 的工作流状态，独立于不可变的错误 Event | Error status、event status |
| **Regression（回归）** | 已标记解决的 Issue 在解决之后再次出现。控制台将它显示为“已回归”，直到有人再次标记解决 | Reopened、recurrence |
| **Web Vital** | LCP、INP、CLS 等真实用户体验测量 | Performance event、timing |
| **API Request** | Page View 或 Session 中观察到的浏览器网络操作 | Endpoint、trace |
| **Custom Event** | Project 定义并带显式属性/测量值的业务观测 | Track、metric event |

## 诊断产物

| 术语 | 含义 | 避免使用 |
| --- | --- | --- |
| **Session Replay** | 经过隐私处理的可见浏览器体验重建 | Recording、video |
| **Source Map Artifact** | 把 Release 的生成代码映射回源代码的构建产物 | Source map file、debug file |
| **Upload Token（上传令牌）** | 可吊销、按 Project 签发的密钥，让 CI 无需 Console 会话即可创建 Release 并上传 Source Map Artifact | API key、CI token、session token |

## 这些术语如何关联

访客在一个 Session 中产生 Event；行为分析聚合 Page View 和 Custom Event；错误 Event 按 Fingerprint 归入 Issue；运维人员可从行为变化或失败 Session 进入 Issue 和对应 Release 的 Source Map Artifact，无需手工复制 ID。

一个 **Instance** 包含多个 **Organization**，一个 Organization 包含多个 **Project**，一个 Project 上报一个或多个 **Environment**。人们通过 Organization 角色获得访问权，Instance Administrator 负责管理整套安装。见[组织、项目与角色](/zh/docs/product/organizations-and-projects/)和[角色与权限](/zh/docs/product/roles-permissions/)。
