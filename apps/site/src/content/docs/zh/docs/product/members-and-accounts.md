---
title: 成员与账号
description: 人如何获得 Organization 的访问权，什么是待审批账号，以及如何管理自己的登录方式。
appliesTo: Alpha
---

获得 OpenRUM 的访问权分两步：一个人需要有一个**账号**，这个账号还需要一个 **Organization 角色**。没有角色的账号可以登录，但看不到任何数据。本页介绍这两步，以及每个人对自己账号的管理。

## 新成员如何获得访问权

OpenRUM 不会发邮件邀请，也不允许自助注册。第一个账号在[首次初始化](/zh/docs/getting-started/production-deployment/first-run/)时创建，其他人按下面的顺序添加：

1. Instance Owner [启用一种登录方式](/zh/docs/getting-started/sign-in/)，例如 Google、GitHub、OIDC 或 LDAP。
2. 新成员用这种方式登录一次，系统为他创建一个**待审批（pending）**账号。
3. Organization 的 Owner 或 Admin 打开**成员与权限**，在**已有用户邮箱**里输入这个人的邮箱，选择角色，点击**添加成员**。
4. 账号变为**已批准**，对方下一次状态检查时就能使用 Console，不需要再做任何操作。

表单是按邮箱查找已有账号的，所以添加一个从未登录过的人会失败。请先让他登录一次，再添加。

待审批的人只能看到自己的访问状态并退出登录，不能读取任何 Project 或 Event。

## 管理成员

打开**成员与权限**，用顶部的选择器选择 Organization。Organization 里的每个人都能看到成员列表。Owner 和 Admin 还可以：

- 添加成员并指定角色
- 修改成员的角色
- 移除成员

你能分配哪些角色取决于你自己的角色。Admin 可以分配 Admin、Member 和 Viewer，但只有 Owner 能分配、修改或移除 Owner。Organization 的最后一名 Owner 不能被降级或移除。各角色的权限见[角色与权限](/zh/docs/product/roles-permissions/)。

移除成员会结束他对该 Organization 及其所有 Project 的访问，但不会删除他的账号，他在其他 Organization 里的访问也保持不变。

### 只让某个人访问部分 Project

角色作用于整个 Organization。想把某个人限制在一个产品上，就把这个产品放进单独的 Organization，并只在那里添加他。见[组织、项目与角色](/zh/docs/product/organizations-and-projects/)。

## 你自己的账号

每个人都在**个人资料**里管理自己的登录方式：

| 任务 | 说明 |
| --- | --- |
| 修改密码 | 适用于有 OpenRUM 密码的账号 |
| 设置 OpenRUM 密码 | 适用于由外部登录创建的账号，密码至少 12 个字符 |
| 关联登录方式 | 为同一个账号增加一种登录途径 |
| 取消关联登录方式 | 只要还剩一种可用的登录方式就可以取消 |

**邮箱相同并不会合并账号。** 如果你已有 OpenRUM 账号，又点了新提供者的登录按钮，登录会因身份冲突被拒绝，而不会并入原账号。请先在已有账号里关联新的登录方式。见[登录 OpenRUM](/zh/docs/getting-started/sign-in/)。

### 为 Instance 角色设置密码

将要持有 Instance Owner 或 Instance Admin 角色的人必须有 OpenRUM 密码，因为敏感的 Instance 操作会再次要求输入。请在授予角色之前让他设置好。这个密码也用于[角色与权限](/zh/docs/product/roles-permissions/#instance-角色)里说的五分钟重新验证。

## 故障排查

| 现象 | 可能原因 |
| --- | --- |
| 添加成员时提示找不到用户 | 他还没有登录过，或账号已被停用 |
| 某人登录后只看到访问状态页 | 账号处于待审批状态，需要 Organization 的 Owner 或 Admin 添加他的邮箱 |
| 用某个提供者登录时报身份冲突 | 该邮箱已有账号。请用原方式登录，再在**个人资料**里关联这个提供者 |
| 成员列表是只读的 | 你的角色是 Member 或 Viewer，请联系 Owner 或 Admin |
| Admin 无法把成员改为 Owner | 这是有意的设计，只有 Owner 能授予或修改 Owner |
