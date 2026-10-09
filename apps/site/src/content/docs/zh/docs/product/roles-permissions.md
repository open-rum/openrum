---
title: 角色与权限
description: Owner、Admin、Member、Viewer 在 Organization 内能做什么，以及 Instance Owner 和 Instance Admin 对整个 Instance 能做什么。
appliesTo: Alpha
---

OpenRUM 对每个请求都在服务端校验权限，所以 Console 里隐藏一个按钮从来不是唯一的保护。角色挂在 **Organization** 上，并适用于其中的每个 Project。Instance 角色是另一套，两个范围的关系见[组织、项目与角色](/zh/docs/product/organizations-and-projects/)。

## Organization 角色

| 角色 | 简述 |
| --- | --- |
| Owner | 完全控制 Organization，包括删除 Project 和管理其他 Owner |
| Admin | 配置 Project 与通知渠道，管理成员（Owner 除外） |
| Member | 处理数据：处理 Issue，管理 Release 和告警规则 |
| Viewer | 对 Organization 内所有 Project 只读 |

### 每个角色能做什么

| 操作 | Owner | Admin | Member | Viewer |
| --- | :-: | :-: | :-: | :-: |
| 查看 Project、Event、Issue、Session、仪表盘、Release 和告警规则 | 可以 | 可以 | 可以 | 可以 |
| 修改 Issue 的状态或负责人 | 可以 | 可以 | 可以 | 不可以 |
| 创建、删除 Release，管理它的 Source Map Artifact | 可以 | 可以 | 可以 | 不可以 |
| 发送测试 Event | 可以 | 可以 | 可以 | 不可以 |
| 创建、编辑、删除告警规则 | 可以 | 可以 | 可以 | 不可以 |
| 管理通知渠道 | 可以 | 可以 | 不可以 | 不可以 |
| 创建 Project，编辑其设置（名称、Environment、允许的 Origin、采样、限流、保留期） | 可以 | 可以 | 不可以 | 不可以 |
| 管理 DSN key 和 Upload Token | 可以 | 可以 | 不可以 | 不可以 |
| 管理入站过滤和处理规则 | 可以 | 可以 | 不可以 | 不可以 |
| 添加成员，修改或移除 Viewer、Member、Admin | 可以 | 可以 | 不可以 | 不可以 |
| 授予、修改或移除 Owner | 可以 | 不可以 | 不可以 | 不可以 |
| 删除 Project 或清除它的数据 | 可以 | 不可以 | 不可以 | 不可以 |

有两个细节值得知道：

- **渠道和规则是分开的。** 通知渠道里保存着 Webhook 地址之类的投递密钥，所以 Member 可以决定存在哪些告警规则，但不能决定告警发往哪里。见[告警](/zh/docs/product/alerts/)。
- **Key 对 Member 不可见。** Project 的 DSN key 只对 Owner 和 Admin 列出。CI 发布 Release 时使用的是 [Upload Token](/zh/docs/sdk/source-maps/)，而不是 Console 会话。

任何访问已被批准的登录用户都可以创建新的 Organization，并成为它的 Owner。这不会让他获得别人 Organization 的访问权。

### 成员管理的限制

- Organization 必须至少保留一名 Owner，降级或移除最后一名 Owner 会被拒绝。
- Admin 不能创建 Owner，也不能修改或移除 Owner，只有 Owner 可以。
- 成员变更会写入该 Organization 的审计日志。

## Instance 角色

Instance 角色控制整套安装范围的设置。它们独立于 Organization 角色：不是某个 Organization 成员的 Instance Owner，无法打开它的 Project。

| 操作 | Instance Owner | Instance Admin |
| --- | :-: | :-: |
| 查看 Instance 概览、配置、维护任务和审计日志 | 可以 | 可以 |
| 修改 Instance 配置项 | 可以 | 可以 |
| 测试对象存储连接 | 可以 | 可以 |
| 预览保留期变更或紧急清理 | 可以 | 可以 |
| 保存托管的对象存储设置 | 可以 | 不可以 |
| 启动保留任务，或会删除数据的紧急清理 | 可以 | 不可以 |
| 添加、修改或移除登录提供者 | 可以 | 不可以 |
| 管理 Instance 成员 | 可以 | 不可以 |

修改 Instance 设置以及任何会删除数据的操作，都会要求操作人重新输入 OpenRUM 密码，验证有效期是五分钟。所以持有 Instance 角色的用户必须有本地 OpenRUM 密码，即使他平时通过外部提供者登录。

Instance 始终至少保留一名 Instance Owner。完成首次初始化的人就是第一个。

## Console 里的体现

Console 遵循同样的规则。没有 Instance 角色的人完全看不到**系统设置**，当前角色无法使用的控件则显示为只读或不出现。关于数据本身的页面，见[发现与排查](/zh/docs/product/investigation/)和[告警](/zh/docs/product/alerts/)。
