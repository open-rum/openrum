---
title: 本地开发
description: 从源码开发 OpenRUM 服务、SDK、Console 和文档站。
---

本文是面向 OpenRUM 贡献者的开发参考。首次运行请先阅读分步骤的[本地开发教程](/zh/docs/getting-started/local-development/)；只想通过容器体验产品、不运行宿主机开发进程时，请使用 [Compose 部署](/zh/docs/self-hosting/compose/)。

## 工具链

- Docker Engine 或 Docker Desktop，Compose v2，至少 8 GB 内存
- Node.js 24、Corepack、pnpm 11.11
- Go 1.26

```sh
corepack enable
pnpm install --frozen-lockfile
```

## 推荐工作流

```sh
pnpm openrum dev
```

`dev` 把基础设施和数据管道服务放在容器中，从源码运行 API 和 Console，因此既有前端热更新，也无需本地安装 PostgreSQL、ClickHouse、Kafka、Redis。命令会构建镜像、迁移、导入 Demo 数据并等待所有健康检查完成。

打开 `http://127.0.0.1:4173`。如需模拟部署形态，让全部服务都运行在容器中：

```sh
pnpm openrum up
```

两种模式共用端口和数据库，不能同时运行；在它们之间切换时 CLI 会停止另一模式，避免两个 API/Consumer 同时处理同一份数据。

| 命令 | 作用 |
| --- | --- |
| `pnpm openrum dev` | API、Console 从源码运行，其余服务在容器中 |
| `pnpm openrum up` | 全部服务容器化运行 |
| `pnpm openrum status` | 查看服务位置和就绪状态 |
| `pnpm openrum logs [service]` | 跟随服务日志 |
| `pnpm openrum restart <name>` | 重启一个服务并等待恢复 |
| `pnpm openrum stop` | 停止全部服务，保留容器和数据 |
| `pnpm openrum down` | 删除容器，保留数据卷 |
| `pnpm openrum reset` | 确认后删除容器和全部本地数据库 |

端口和凭据来自 `deploy/compose/.env`，没有时回退到已提交的 `.env.example`。后台进程的 PID 和日志位于 git 忽略的 `.openrum/`。

开发账号：

```text
Email: demo@openrum.local
Password: OpenRUM-demo-2026!
```

这些账号和 DSN 只用于本地环境。

## 对象存储

行为分析、错误、性能和 API 监控不依赖对象存储。只有测试 Source Map 时才需要配置 OSS 或 S3 兼容 Provider。生产自定义 Endpoint 必须使用 HTTPS 并加入 `OPENRUM_OBJECT_STORAGE_ENDPOINT_ALLOWLIST`；优先使用工作负载角色而不是静态 Key。

## 常用验证命令

```sh
# 前端
pnpm --filter @openrum/web test:unit
pnpm --filter @openrum/web typecheck
pnpm --filter @openrum/web lint

# Go
go test ./...
go vet ./...

# 全仓检查、集成测试和浏览器流程
pnpm run check
pnpm run test:integration
pnpm run test:e2e
```

`pnpm run check` 包含格式化、Lint、类型检查、测试、协议生成检查、构建和体积预算。集成测试只允许连接 localhost 且数据库名必须以 `_test` 结尾，防止误删真实数据。

## 迁移与日志

迁移和 Demo Seed 会在每次启动时幂等执行，无需手工重跑。

```sh
pnpm openrum status
pnpm openrum logs api
pnpm openrum logs ingest consumer worker
```

如果 Host 服务失败，查看 `.openrum/log/api.log` 或 `.openrum/log/web.log`。

## 文档站

文档站不属于运行时栈，也不需要基础设施依赖：

```sh
pnpm site:dev
pnpm site:check
```

公开站点或文档改动在请求评审前运行 `site:check`，它会检查生成的参考内容、拼写、Demo 证据、静态构建、链接和站点性能预算。公开文档必须同时维护 `docs/` 英文页和 `zh/docs/` 同路径中文页。

## 常见问题

- 端口冲突时，`openrum` 会指出占用进程；不会自动终止外部进程。
- 写入返回 CSRF 错误时，确认浏览器 Origin 与 `PUBLIC_BASE_URL` 完全一致。
- 图表初始为空时，等待 ClickHouse 物化视图处理后刷新。
- 依赖漂移时在仓库根目录运行 `pnpm install --frozen-lockfile`。

重新造数和数据集说明见[确定性 Demo 数据](/zh/docs/getting-started/demo-data/)。
