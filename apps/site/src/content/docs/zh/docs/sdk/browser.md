---
title: Browser SDK 接入
description: 自动采集、自定义事件、身份、隐私与采样。
---

**发布包：** `@openrum/browser`（Alpha）。

```sh
pnpm add @openrum/browser
```

```ts
import { captureEvent, init, setUser } from "@openrum/browser";

const client = init({
  endpoint: "https://rum.example.com/ingest/v1/envelope",
  writeKey: import.meta.env.VITE_OPENRUM_WRITE_KEY,
  environment: "production",
  release: "storefront@1.8.0",
});
```

SDK 自动采集 Page View、受限交互描述、JavaScript 错误、未处理 Promise、fetch/XHR 时序和 Core Web Vitals。默认不采集 query、请求/响应 body、header、输入框原始值，以及 OpenRUM 自身的 ingest 地址。

## 自定义事件

```ts
captureEvent("checkout_started", {
  attributes: { plan: "standard", channel: "organic" },
  measurements: { cart_value: 249.9 },
});
```

名称与取值都有边界并会在浏览器侧清洗。不要发送邮箱、手机号、支付信息、认证 Token 或自由文本。

## 身份

使用 `setUser("account_opaque_id")`。请优先使用内部不透明 ID；邮箱会被拒绝。`setUser(undefined)` 可清除身份。Session 是活动窗口，会独立于用户身份续期。

## 采样

错误采样与普通事件、API Request 相互独立。远端 Project 配置刷新间隔不少于五分钟；无效配置会安全回退到本地值。

下一步：[创建第一个项目](/zh/docs/getting-started/create-first-project/)、[安全与隐私](/zh/docs/security/privacy/)。
