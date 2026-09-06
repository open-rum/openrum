# OpenRUM Public Website & Documentation Plan

## 1. Purpose

OpenRUM 的公共站点是开源项目的产品入口，不是 SaaS 营销漏斗。它需要让第一次到访的前端负责人、产品工程师和自部署运维人员在几分钟内回答四个问题：

1. OpenRUM 解决什么问题？
2. 它与单独使用行为分析或错误监控工具有什么不同？
3. 我能否在自己的基础设施中可靠运行它？
4. 我现在如何体验、接入或参与贡献？

公共站点不承担组织、Project、登录或系统管理能力；这些能力继续由 `apps/web` 控制台提供。

## 2. Product Narrative

### Primary message

- **首页标题：** 开源自部署的用户行为分析与错误监控平台。
- **Tagline：** 看懂用户行为，定位每一个前端错误。
- **核心故事：** 从行为异常进入 Session，再到 Issue、Source Map Artifact 和关联 API Request；调查上下文不因切换工具而丢失。

### Evidence before claims

公共页面只展示已经具备或有明确状态标记的能力。所有规模、安全和兼容性声明必须链接到可复现的基准、威胁模型、Release 或文档，不使用“无限扩展”“零成本”“完整替代”等不可验证表述。

### Calls to action

| Priority  | CTA      | Destination                        | Intent                       |
| --------- | -------- | ---------------------------------- | ---------------------------- |
| Primary   | 快速开始 | `/docs/getting-started/quickstart` | 在本地启动并看到第一个 Event |
| Secondary | GitHub   | Repository                         | 阅读源码、Star、提交 Issue   |

当前免费、自部署阶段不显示“注册”“购买”“价格”或“联系我们开通”作为主要 CTA。

## 3. Information Architecture

### Public routes

| Route         | Purpose                      | Required content                                                                 |
| ------------- | ---------------------------- | -------------------------------------------------------------------------------- |
| `/`           | 建立产品心智并推动第一次体验 | Hero、统一调查路径、核心能力、自部署证明、真实规模验证、CTA                      |
| `/product`    | 解释产品边界和工作方式       | Behavior Analytics、Issues、Performance、Events、API、Alerts、Insights；能力状态 |
| `/self-host`  | 降低部署风险                 | 部署档位、依赖拓扑、数据所有权、升级/备份入口、资源估算                          |
| `/benchmarks` | 公开性能证据                 | 环境、数据集、方法、结果、已知限制和复现命令                                     |
| `/community`  | 建立开源参与入口             | Contributing、Issue、Roadmap、Security policy、Release links                     |
| `/docs/*`     | 学习、接入和运维             | 下方文档结构                                                                     |

首阶段不做博客、价格页、客户 Logo 墙、云托管注册和独立 CMS。

### Documentation navigation

1. **Start Here** — 产品介绍、五分钟 Quickstart、创建第一个 Project、验证第一个 Event、本地 Demo 数据。
2. **Concepts** — Instance、Organization、Project、Environment、Release、Event、Session、Issue、Fingerprint。
3. **SDK Guides** — Browser SDK 安装、自动采集、自定义 Event、用户身份、隐私、采样、Source Map 上传、框架示例。
4. **Product Guides** — 分析、Issue 调查、性能、Event、API Request、告警、洞察、Project 设置。
5. **Self-hosting** — Compose、Kubernetes/Helm、外部依赖、容量规划、配置参考。
6. **Operations** — 升级、备份恢复、数据生命周期、OSS、Kafka、ClickHouse、PostgreSQL、Redis、故障排查。
7. **Security & Privacy** — 默认采集边界、脱敏、权限、威胁模型、漏洞报告。
8. **Reference** — SDK API、Event schema、HTTP API、环境变量、Helm values、版本兼容矩阵。
9. **Contributing** — 本地开发、测试、Demo 数据、架构、Roadmap 和贡献流程。

术语必须遵守根目录 `CONTEXT.md`。Reference 中可从 schema、SDK 类型、Go 配置和 Helm values 生成的内容不允许手工维护第二份事实源。

## 4. Technical Boundary

### Recommended shape

新增一个静态公共应用 `apps/site`，统一承载营销页面和 `/docs`：

- 使用 Astro 构建静态页面，文档层使用 Starlight；React 只用于确有必要的交互 island。
- `packages/design-tokens` 向控制台和公共站提供同一套语义变量，`packages/ui` 提供同一套 shadcn/ui primitives；两个应用不得复制或重新命名主题 Token。
- 公共站使用与控制台一致的 Radix Nova、Radix、Tailwind CSS v4、CSS variables 和 Lucide 配置，但与控制台 bundle、认证状态及运行时 API 解耦。
- Starlight 负责文档信息架构、搜索和导航；其可见主题映射到共享 Token，自定义交互和反馈组件遵守 `docs/design.md` 的 shadcn contract。
- 默认部署为一个 origin；文档固定在 `/docs`，避免首阶段维护两个应用、两套导航和两条发布链路。
- 内容保留在 Git 仓库中并通过 Pull Request 审核，不引入数据库或 CMS。
- Site 构建不得依赖 OpenRUM 后端可用，也不依赖托管的 OpenRUM 实例。

如果未来需要独立版本化文档域名，再以构建配置拆分，不在首阶段预先拆成 `apps/site` 和 `apps/docs` 两个应用。

### Deployment and observability

- 每个 Pull Request 生成静态预览；主分支发布生产站。
- 发布产物必须支持不可变缓存；HTML 使用短缓存，带 hash 的资源使用长缓存。
- 公共站可用独立的 OpenRUM Project 进行 dogfooding，但必须遵守自身隐私文档，不设置第三方广告或跨站追踪器。
- 发布页底部显示 Release、commit 和文档反馈入口；产品能力状态与对应 Release 一致。

## 5. Content and Localization

- 英文是 Reference 和深层运维文档的事实源，方便开源协作。
- 首页、Product、Self-host、Quickstart 和核心 SDK 接入提供英文与简体中文。
- 语言切换保留当前页面；缺少翻译时明确回退到英文，不静默显示过期译文。
- 代码、配置键、Route 和领域术语不翻译；说明文本可本地化。
- 所有页面标明“适用于哪个 OpenRUM Release”，过期内容必须显示版本提示。

首阶段只要求上述关键页面双语；全量文档逐页翻译不阻塞发布。

## 6. Experience Requirements

- 延续 `docs/design.md` 的 Stripe-inspired、专业可信风格，使用共享 Token 和 shadcn/ui 规范，支持 light/dark，并使用适合长文阅读的字号和行高。
- 桌面与移动端均保持清晰导航；文档支持目录、面包屑、上一页/下一页、复制代码、标题锚点和键盘操作。
- 本地静态搜索覆盖标题、正文和 API 条目，不向第三方发送查询。
- 代码示例必须可复制、标明文件位置和运行环境；Quickstart 的命令需在 CI 中实际执行。
- 图表、架构图和产品截图需要文字替代；状态、能力和性能结论不能只用颜色表达。
- 错误页面应提供搜索、Quickstart、GitHub Issue 和返回上一层的恢复路径。

## 7. Acceptance Metrics

### Product outcomes

- 新用户从首页进入 Quickstart 后，能在 15 分钟内启动本地 Demo 并完成推荐调查路径。
- 贡献者仅依赖文档即可完成本地开发、生成 Demo 数据和运行核心测试。
- 运维人员能从 Self-host 页面进入匹配其部署方式的安装、升级、备份和容量文档。

### Quality gates

- 生产构建无内部坏链、孤立页面和重复 canonical URL。
- Landing、Quickstart、SDK 安装、自部署首页通过自动可访问性检查，无 critical violation。
- 公共 Landing 的移动端 LCP 目标 <2.5s、INP <200ms、CLS <0.1；关键页面 Lighthouse Performance/Accessibility/SEO 目标均不低于 90。
- Quickstart、配置示例和代码片段由 CI smoke test 验证；生成 Reference 的工作区必须保持 clean。
- 页面元数据、Open Graph、sitemap、robots 和 404 行为经过生产域名验证。

## 8. Release Scope

### P0 — Launchable public surface

- 公共站 shell、首页、Product、Self-host、Community。
- `/docs` 信息架构、现有文档迁移、搜索和核心 Quickstart。
- Browser SDK、自定义 Event、Source Map、自部署与运维核心文档。
- 英文 + 核心页面简体中文、light/dark、SEO、可访问性和发布预览。

### P1 — Trust and adoption

- 可复现 Benchmarks 页面、完整配置 Reference、版本兼容矩阵。
- 更多框架接入指南、故障排查决策树和完整简体中文覆盖。
- 使用 OpenRUM dogfooding 的公开、隐私安全的站点质量数据。

### P2 — Community growth

- Release notes 聚合、案例、插件/集成目录和可维护的内容发布流程。
- 仅在内容产出稳定后评估博客或 CMS。

## 9. Launch Decisions

1. **发布目标：** canonical production domain 使用 `https://openrum.dev`；Repository CTA 默认指向 `https://github.com/openrum/openrum`。二者都是发布配置目标，CI 必须通过 `PUBLIC_SITE_URL` 与 `PUBLIC_REPOSITORY_URL` 显式注入并在真实 DNS/Repository 就绪后做外部验证，文档不把尚未连接的地址描述为已上线。
2. **容量声明：** 首页不公布“千万 PV”“无限扩展”等容量数字。`/benchmarks` 只发布仓库内存在原始产物、环境说明和复现命令的结果；失败或未达到目标的结果同样保留，并明确标为本地测试而非生产承诺。
3. **版本策略：** Alpha 阶段只维护 `latest`，每页显示适用版本或 Alpha 状态；首个稳定 Release 之后才冻结历史文档版本。英文 Reference 是深层技术内容的事实源，缺少中文翻译时显示回退提示。

### Public claim inventory

| Claim | Status | Source of truth / evidence |
| --- | --- | --- |
| Open-source and self-hosted product direction | Implemented software; public release pending | Compose/Helm manifests; an explicit repository license and public release metadata remain launch gates |
| Behavior analytics + frontend error monitoring | Implemented | Browser SDK, ingest schema, Analytics/Session/Issue product routes |
| PV/UV, acquisition, country, device and browser analysis | Implemented | Query handlers and seeded local Demo |
| Session context, Issue grouping and mapped Source Map frames | Implemented | Issue, Session and Release/Artifact APIs plus deterministic Demo path |
| Web Vitals, route performance and API request monitoring | Implemented | Browser integrations and Performance/API queries |
| Alibaba OSS and S3-compatible artifact storage | Implemented, optional | Admin storage diagnostics and operations guide |
| 30,000-session synthetic Demo | Released in Alpha source | Deterministic Demo generator and verification script; never production data |
| Production capacity or availability SLA | Not claimed | Requires deployment-specific benchmark and operator evidence |
| Hosted Cloud, online Demo, pricing or signup | Planned only | Deliberately absent from the current public IA |

Public copy must use the status above. A feature without implementation or evidence is labelled planned or omitted; a local benchmark is never presented as a customer-production result.

在线演示和托管运行环境不属于当前开源自部署阶段；未来确定 Cloud 产品后再单独规划入口、隔离、成本和账号体系。
