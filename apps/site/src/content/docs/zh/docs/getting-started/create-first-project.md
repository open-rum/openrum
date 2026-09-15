---
title: 创建第一个项目
description: 创建 Project、安装 Browser SDK，并验证第一个 Event。
---

**适用于：** Alpha / main。

请先按 [五分钟快速开始](/zh/docs/getting-started/quickstart/) 启动本地 Instance。评估阶段可使用 Demo Organization；准备发送真实浏览器流量时再创建自己的 Project。

## 1. 创建 Project

1. 打开 `http://127.0.0.1:4173` 并登录控制台。
2. 进入 **设置 → 项目**，为单个 Web 产品创建一个 Project。
3. 选择 Environment，例如 `development` 或 `production`。
4. 在 **设置 → 客户端 DSN** 复制随项目自动生成的默认 DSN。这个字符串已包含公开 Ingest 地址和只写凭证，主要依赖 Origin 白名单与限流。

## 2. 安装 Browser SDK

```sh
pnpm add @openrum/browser
```

```ts
import { captureEvent, init } from "@openrum/browser";

init({
  dsn: import.meta.env.VITE_OPENRUM_DSN,
  environment: "development",
  release: "storefront@0.1.0",
});

captureEvent("first_event", {
  attributes: { source: "create-first-project" },
});
```

可运行示例见仓库 `examples/react-vite`。复制 `.env.example` 为 `.env.local`，填入 DSN 后执行：

```sh
pnpm --filter @openrum/example-react-vite dev
```

更多内容见 [Browser SDK](/zh/docs/sdk/browser/)。

## 3. 验证第一个 Event

1. 打开你的应用，触发页面访问或 `first_event` 自定义事件。
2. 在控制台打开 **事件**，确认几秒内可见。
3. 打开 **会话**，确认同一 `session_id` 关联页面、API 与错误事件。
4. 若触发了错误，跟随到 **Issue** 并查看会话上下文。

## 故障排查

- 事件缺失：检查 Ingest 健康、DSN、Origin 白名单，以及 Consumer / ClickHouse。
- CORS 或网络失败：DSN 中的地址必须匹配公开 Ingest 地址与允许的 Origin。
- Source Map 不可用：未配置对象存储时属预期；核心监控仍可用。
