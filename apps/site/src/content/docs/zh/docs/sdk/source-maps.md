---
title: Release 与 Source Map
description: 使用 Vite 插件上传私有 Source Map Artifact。
---

对象存储对核心监控是可选的，但 Source Map 映射需要对象存储。

```sh
pnpm add -D @openrum/vite-plugin
```

```ts
import { defineConfig } from "vite";
import { openRUMSourceMaps } from "@openrum/vite-plugin";

export default defineConfig({
  build: { sourcemap: true },
  plugins: [openRUMSourceMaps({
    baseUrl: process.env.OPENRUM_API_URL!,
    projectId: process.env.OPENRUM_PROJECT_ID!,
    release: process.env.OPENRUM_RELEASE!,
    sessionCookie: process.env.OPENRUM_SESSION!,
    csrfToken: process.env.OPENRUM_CSRF_TOKEN!,
  })],
});
```

Alpha 插件会创建 Release、申请短期上传授权、校验 Artifact 元数据，并在发起网络请求前
从公开构建产物中删除 `.map` 文件。Console Session 和 CSRF 值必须保存在 CI Secret 中。
专用上传 Token 尚在规划中，不能按已交付能力使用。

验证时，在相同 Release 中触发一个已知的压缩代码错误，并查看 Issue 详情中的 Source Map
诊断。成功映射会保留原始栈帧，同时补充源文件路径、行和列。
