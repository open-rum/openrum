<p align="center">
  <img src="apps/site/public/favicon.svg" width="72" height="72" alt="OpenRUM 信号小怪" />
</p>

<h1 align="center">OpenRUM</h1>

<p align="center">
  部署在自己基础设施上的开源前端监控平台。<br />
  将错误、性能、日志与用户行为关联起来，快速定位问题。
</p>

<p align="center">
  <a href="https://openrum.netlify.app/zh/">官网</a> ·
  <a href="https://openrum.netlify.app/zh/docs/getting-started/quickstart/">文档</a> ·
  <a href="#快速启动">快速启动</a> ·
  <a href="https://github.com/eijil/openrum/issues">反馈问题</a>
</p>

<p align="center">
  <a href="https://github.com/eijil/openrum/actions/workflows/ci.yml"><img src="https://github.com/eijil/openrum/actions/workflows/ci.yml/badge.svg" alt="CI 状态" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT 许可证" /></a>
  <img src="https://img.shields.io/badge/status-Alpha-ffb020" alt="Alpha" />
</p>

<p align="center"><a href="README.md">English</a> · <strong>简体中文</strong></p>

OpenRUM 是面向 Web 产品的自托管真实用户监控（RUM）平台。你可以从一个错误、一次慢请求或一次转化下降出发，结合相关会话和事件调查原因。监控数据保存在你自己管理的基础设施中。

**Alpha 阶段：** 项目正在持续开发，首个稳定版本发布前，数据结构与 API 可能发生变化。

## 能做什么

| 领域             | 能力                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------ |
| **错误与排查**   | 将 JavaScript 错误聚合为 Issue，通过 Source Map 还原堆栈，并查看问题发生前后的会话时间线。 |
| **性能与 API**   | 监控 Core Web Vitals、页面路由性能、请求耗时和 API 失败情况。                              |
| **行为分析**     | 分析访问量、访客、来源、设备与浏览器，使用自定义事件、漏斗、路径和留存了解用户行为。       |
| **日志**         | 按级别、用户或会话搜索结构化浏览器日志，并跳转到相关监控记录。                             |
| **仪表盘与告警** | 自定义项目仪表盘，配置指标告警，通过飞书 / Lark 或 Webhook 发送通知。                      |
| **团队访问**     | 管理组织与成员角色，在本地密码登录之外启用 Google、GitHub、LDAP 或多个 OIDC 提供者。       |

浏览器 SDK 自动采集时不读取原始输入值、请求与响应正文或请求头；URL 会经过规范化，敏感值会进行脱敏。完整采集边界见[隐私说明](https://openrum.netlify.app/zh/docs/self-hosting/security/privacy/)。

## 快速启动

准备 **Git**、带有 **Compose v2 的 Docker**，并为 Docker 分配至少 **8 GB 内存**。

```sh
git clone https://github.com/eijil/openrum.git
cd openrum

docker compose --env-file deploy/compose/.env.example \
  -f deploy/compose/docker-compose.yml up -d --build
```

首次启动会构建服务、执行数据库迁移，并加载覆盖 **14 天、约 30,000 个会话**的电商演示数据。等待常驻服务进入健康状态：

```sh
docker compose --env-file deploy/compose/.env.example \
  -f deploy/compose/docker-compose.yml ps
```

打开 **[http://127.0.0.1:4173](http://127.0.0.1:4173)**，使用以下账号登录：

| 邮箱                 | 密码                 |
| -------------------- | -------------------- |
| `demo@openrum.local` | `OpenRUM-demo-2026!` |

通过演示数据体验仪表盘、错误、性能和会话排查。对象存储是可选依赖，需要上传 Source Map 产物时再配置。

停止服务并保留数据：

```sh
docker compose --env-file deploy/compose/.env.example \
  -f deploy/compose/docker-compose.yml down
```

这套配置使用示例凭据和单节点依赖，仅用于本地体验。实际部署请使用[单机 Docker](https://openrum.netlify.app/zh/docs/self-hosting/docker-production/) 或 [Kubernetes / Helm](https://openrum.netlify.app/zh/docs/getting-started/production-deployment/) 指南。遇到端口占用或启动失败时，查看 [Compose 排错说明](https://openrum.netlify.app/zh/docs/self-hosting/compose/)。

## 接入第一个项目

在控制台创建项目，将被监控网站的 Origin 加入允许列表，并复制客户端 DSN。对于本地测试页面，可以直接加载当前实例提供的浏览器 SDK：

```html
<script src="http://127.0.0.1:4173/api/v1/sdk/browser/0.1.0/openrum.min.js"></script>
<script>
  OpenRUM.init({
    dsn: "PASTE_YOUR_PROJECT_DSN",
    environment: "development",
  });
</script>
```

将 DSN 替换为项目提供的值。接入线上网站时，请使用你自己的实例 HTTPS SDK 地址。[创建第一个项目](https://openrum.netlify.app/zh/docs/getting-started/create-first-project/)和[浏览器 SDK 指南](https://openrum.netlify.app/zh/docs/sdk/browser/)介绍了异步加载、框架接入与验证步骤；可运行的 React + Vite 示例位于 [examples/react-vite](examples/react-vite)。

## 文档导航

| 你想做什么          | 对应文档                                                                                                                                                                              |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 选择安装方式        | [开始使用](https://openrum.netlify.app/zh/docs/getting-started/quickstart/)                                                                                                           |
| 接入前端项目        | [浏览器 SDK](https://openrum.netlify.app/zh/docs/sdk/browser/) · [Next.js](https://openrum.netlify.app/zh/docs/sdk/nextjs/) · [Astro](https://openrum.netlify.app/zh/docs/sdk/astro/) |
| 配置登录            | [邮箱、Google、GitHub、LDAP 与 OIDC（仓库指南）](apps/site/src/content/docs/zh/docs/getting-started/sign-in/index.mdx)                                                                |
| 部署与维护实例      | [自托管概览](https://openrum.netlify.app/zh/docs/self-hosting/overview/) · [备份与恢复](https://openrum.netlify.app/zh/docs/self-hosting/backup-restore/)                             |
| 上传 Source Map     | [Source Map 接入](https://openrum.netlify.app/zh/docs/sdk/source-maps/)                                                                                                               |
| 查询服务和 SDK 配置 | [配置参考](https://openrum.netlify.app/zh/docs/reference/configuration/) · [SDK 选项](https://openrum.netlify.app/zh/docs/reference/sdk-options/)                                     |

## 架构

TypeScript 浏览器 SDK 将事件发送至 Go Ingest，经 Kafka 缓冲、Consumer 处理后写入 ClickHouse。React 控制台通过 Go API 查询这些事件。

| 组件                                 | 职责                           |
| ------------------------------------ | ------------------------------ |
| React、TypeScript、Vite 和 shadcn/ui | 控制台与项目分析界面           |
| Go API、Ingest、Consumer 和 Worker   | 认证、事件接收、处理与后台任务 |
| ClickHouse                           | 事件存储与分析查询             |
| PostgreSQL                           | 用户、项目与配置               |
| Kafka 和 Redis                       | 采集缓冲、配额与临时状态       |
| 可选 OSS 或 S3 兼容存储              | Source Map 产物                |

完整事件链路与依赖职责见[架构说明](https://openrum.netlify.app/zh/docs/self-hosting/architecture/)。

## 开发与贡献

源码开发需要 **Node.js 24**、**pnpm 11.11**、**Go 1.26** 和 Docker。在仓库根目录执行：

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm openrum dev
```

该命令从源码运行 API 和控制台，将基础设施及数据处理服务放在容器中。控制台地址仍为 `http://127.0.0.1:4173`。服务管理命令与排错方法见[本地开发](https://openrum.netlify.app/zh/docs/contributing/local-development/)。

欢迎提交问题、改进文档、补充测试或贡献代码。请先阅读[贡献指南](https://openrum.netlify.app/zh/docs/contributing/)，较大的变更先通过 [GitHub Issues](https://github.com/eijil/openrum/issues) 讨论，提交 Pull Request 前运行 `pnpm run check`。修改文档时，还需运行 `pnpm site:check`。

安全漏洞请按[安全报告指南](https://openrum.netlify.app/zh/docs/self-hosting/security/vulnerability-reporting/)私下反馈。

## 许可证

[MIT](LICENSE)。
