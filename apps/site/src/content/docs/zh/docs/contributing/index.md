---
title: 参与贡献
description: 开发、测试并向 OpenRUM 提交改动。
---

OpenRUM 欢迎聚焦于 Alpha 产品、文档和运维安全的改进。

## 工具链

- Node.js 24、Corepack、pnpm 11
- `go.mod` 指定的 Go 版本
- Docker 与 Compose v2

```sh
corepack enable
pnpm install --frozen-lockfile
```

依赖启动、Vite 代理和常用命令见[本地开发](/zh/docs/contributing/local-development/)，测试数据见[确定性 Demo 数据](/zh/docs/getting-started/demo-data/)。

## 仓库结构

| 路径 | 用途 |
| --- | --- |
| `apps/web` | React Console |
| `apps/site` | 官网和文档 |
| `packages/browser-sdk` | 带隐私边界的 Browser SDK |
| `packages/protocol` | Event 协议 |
| `packages/vite-plugin` | Source Map 上传 |
| `services` | Go API、Ingest、Consumer、Worker |
| `internal` | 共享领域与基础设施代码 |
| `migrations` | PostgreSQL 与 ClickHouse 迁移 |
| `tests/e2e` | Playwright 产品流程 |

## 提交改动前

```sh
pnpm run check
pnpm exec playwright test
docker compose --env-file deploy/compose/.env.example -f deploy/compose/docker-compose.yml config --quiet
```

为变更行为增加聚焦的 Go/React 测试，跨页面产品流程放在 Playwright。迁移必须向前兼容并遵守数据保留策略。

## 产品与隐私约束

- 不采集表单原值、密码、Authorization Header、Cookie 或无限基数 URL。
- 持久化前归一化 Route 和 API URL。
- 术语与[领域模型](/zh/docs/getting-started/domain-model/)及根目录 `CONTEXT.md` 一致。
- 洞察必须能跳转到可检查的证据。
- 保持键盘导航、可见焦点、响应式布局和明暗主题。
- 所有公开文档改动必须同时更新同路径的英文与简体中文页面。

Pull Request 应说明动机、Schema/API 变化、UI 截图、隐私影响和准确的验证命令。
