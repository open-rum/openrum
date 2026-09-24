---
title: 领域模型
description: Instance、Organization、Project、Event、Session、Issue 和 Release 的统一术语。
---

OpenRUM 文档、Console 和 API 共用一套术语，根目录 `CONTEXT.md` 是权威来源。

## 所有权与交付

| 术语 | 含义 | 避免使用 |
| --- | --- | --- |
| **Instance** | 一套自托管 OpenRUM 及其全局运维策略边界 | Tenant、cluster、workspace |
| **Instance Administrator** | 管理 Instance 配置、数据生命周期和外部依赖的运维人员 | Super admin、organization admin |
| **Organization** | 拥有 Project、成员和访问策略的团队边界 | Tenant、account、workspace |
| **Project** | 作为一个报告边界被监控的 Web 产品 | App、application、service |
| **Environment** | Project 内的部署范围，如 production、canary 或 test | Stage、namespace |
| **Release** | 将观测数据关联到一次交付的构建标识 | Version、deployment |

## 观测数据

| 术语 | 含义 | 避免使用 |
| --- | --- | --- |
| **Event** | 在某个时间点采集的不可变观测 | Log、record、message |
| **Page View** | 页面或客户端 Route 变为可见时的 Event | Hit、impression |
| **Session** | 将访客 Event 关联为一次旅程的有限活动周期 | Visit、replay |
| **Issue** | 可统一调查和处理的一组等价错误 Event | Error、exception、incident |
| **Fingerprint** | 决定错误归入哪个 Issue 的版本化稳定标识 | Issue ID、hash、signature |
| **Issue State** | Project 维度附加到 Issue 的工作流状态 | Error status、event status |
| **Web Vital** | LCP、INP、CLS 等真实用户体验测量 | Performance event、timing |
| **API Request** | Page View 或 Session 中观察到的浏览器网络操作 | Endpoint、trace |
| **Custom Event** | Project 定义并带显式属性/测量值的业务观测 | Track、metric event |

## 诊断产物

| 术语 | 含义 | 避免使用 |
| --- | --- | --- |
| **Session Replay** | 经过隐私处理的可见浏览器体验重建 | Recording、video |
| **Source Map Artifact** | 把 Release 的生成代码映射回源代码的构建产物 | Source map file、debug file |

访客在一个 Session 中产生 Event；行为分析聚合 Page View 和 Custom Event；错误 Event 按 Fingerprint 归入 Issue；运维人员可从行为变化或失败 Session 进入 Issue 和对应 Release 的 Source Map Artifact，无需手工复制 ID。
