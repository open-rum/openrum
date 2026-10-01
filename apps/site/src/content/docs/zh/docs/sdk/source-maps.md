---
title: Release 与 Source Map
description: 在 CI 中使用项目上传令牌上传私有 Source Map，把压缩代码中的错误还原到源码位置。
---

**适用于：** Alpha。

Source Map Artifact 可以把 `index-abc.js:1:48213` 这样的压缩栈帧还原成
`src/checkout/cart.ts:42:7`。OpenRUM 中的 Source Map 始终是私有的：由 CI 上传到 Instance
的对象存储，不会随站点一起部署。

:::note[需要对象存储]
核心监控不依赖对象存储。Source Map 的上传和还原需要 Instance 配置 OSS 或 S3 兼容 Bucket，
参见[对象存储](/zh/docs/self-hosting/object-storage/)。存储未配置或不可用时，Console 的「发布」页会显示提示横幅。
:::

## 创建上传令牌

1. 在 Console 中打开 **设置 → 项目 → 接入指引**（`/projects/<id>/onboarding`）。
2. 在 **Source Map 上传令牌** 区块新建令牌，名称建议写明使用它的流水线，例如
   `github-actions-storefront`。只有 Owner 和 Admin 可以创建或吊销令牌，其他成员可以查看列表。
3. 立即复制明文（`orut_…`），它只显示一次。把它保存为名为 `OPENRUM_UPLOAD_TOKEN` 的 CI Secret。

令牌只属于一个项目，只能创建 Release、上传和列出 Artifact，不能删除 Release 或 Artifact，
吊销后立即失效。令牌列表会显示每个令牌的最近使用时间，便于吊销闲置或泄露的令牌。

## 配置 Vite 插件

Alpha 阶段插件尚未发布到 npm。请在 OpenRUM 仓库中构建，再把该目录安装到你的应用：

```sh
pnpm --filter @openrum/vite-plugin build
pnpm add -D /path/to/openrum/packages/vite-plugin
```

```ts title="vite.config.ts"
import { defineConfig } from "vite";
import { openRUMSourceMaps } from "@openrum/vite-plugin";

export default defineConfig({
  build: { sourcemap: "hidden" },
  plugins: [
    openRUMSourceMaps({
      baseUrl: process.env.OPENRUM_BASE_URL!,
      projectId: process.env.OPENRUM_PROJECT_ID!,
      release: process.env.OPENRUM_RELEASE!,
      commitSha: process.env.GITHUB_SHA,
      // token 默认读取 process.env.OPENRUM_UPLOAD_TOKEN
    }),
  ],
});
```

`build.sourcemap: "hidden"` 让 Vite 生成 `.map` 文件，但不在产物中写入 `sourceMappingURL`
注释。若设置为 `true`，插件会替你删除这些注释。

每次构建时插件会：

1. 把构建产物下所有 `.map` 文件读入内存，并在发起第一个网络请求前从产物中删除，因此上传失败
   也不会在可部署目录中留下 Source Map。同时删除产物 `.js`、`.mjs`、`.cjs` 和 `.css` 文件中的
   `sourceMappingURL` 注释。
2. 创建 Release；相同版本和 dist 已存在时直接复用。
3. 通过短期有效的预签名 URL 上传，最多同时上传 4 个文件。网络错误、`5xx` 和 `429` 响应会以指数
   退避重试 2 次，校验错误不会重试。
4. 输出汇总，例如 `3 uploaded, 12 skipped (unchanged), 0 failed`；任一文件失败时构建失败。

不经过 Vite 的构建可以使用 `openrum-sourcemaps` CLI，行为相同。它读取 `OPENRUM_BASE_URL`、
`OPENRUM_PROJECT_ID`、`OPENRUM_RELEASE`、`OPENRUM_DIST`、`OPENRUM_UPLOAD_TOKEN` 和
`OPENRUM_URL_PREFIX`，也可以使用对应的命令行参数：

```sh
pnpm exec openrum-sourcemaps --out-dir dist --url-prefix static/app/
```

## Release 与 dist 必须和 SDK 一致

还原时按每个错误事件上的 `release` 和 `dist` 查找 Artifact。插件和 Browser SDK 必须传入完全
相同的值：

```ts title="src/monitoring.ts"
init({
  dsn: import.meta.env.VITE_OPENRUM_DSN,
  release: import.meta.env.VITE_APP_RELEASE, // 与 OPENRUM_RELEASE 相同
});
```

没有 `release` 的事件无法还原。`dist` 不同，或只在一侧设置了 `dist`，都会查到另一个 Release。

## Artifact 命名与 `urlPrefix`

Artifact 按名称匹配。名称是脚本 URL 的路径，去掉协议、域名、查询参数、片段和开头的 `/`，再加上
`.map`。插件用 `urlPrefix` 加上文件相对构建产物目录的路径生成名称。

| 堆栈中的脚本 URL                                         | `dist` 中的文件           | `urlPrefix`   | Artifact 名称                        |
| -------------------------------------------------------- | ------------------------- | ------------- | ------------------------------------ |
| `https://shop.example.com/assets/index-abc.js`           | `assets/index-abc.js.map` | 不设置        | `assets/index-abc.js.map`            |
| `https://cdn.example.com/static/app/assets/index-abc.js` | `assets/index-abc.js.map` | `static/app/` | `static/app/assets/index-abc.js.map` |

站点部署在子路径下时，例如 Vite `base` 为 `/static/app/` 或一个 CDN URL，需要设置 `urlPrefix`。
插件会规范化斜杠，完整 URL 只取其路径部分。栈帧显示 `missing_artifact` 时，先对比栈帧 URL 的
路径和已上传的名称。

## 重复构建与迟到上传

- **同一 Release 可以安全地重复构建。** Release 会被复用，名称和 SHA-256 都相同的文件直接跳过，
  不会重复上传。
- **内容变化的文件应使用新 Release。** 名称相同但内容不同的文件会以 `ARTIFACT_EXISTS` 失败。
  确实需要覆盖时，设置 `replace: true` 或传入 `--replace`。
- **迟到上传会补还原近期错误。** Artifact 变为可用后，该 Release 与 dist 下近 7 天内未完全还原
  的错误会自动重新还原。更早的事件保留生成代码位置。

单个 Source Map 最大 64 MiB。插件会在上传前拒绝更大的文件，请把产物拆分成更小的 chunk。

## 验证还原

1. 在主导航打开 **发布**，选择对应 Release。徽标显示已上传文件中可用的数量。
2. 使用匹配测试器：填入生产错误中生成代码的帧 URL、行和列，确认能还原到预期的源文件和行号。
3. 在已部署的构建中触发一个已知错误，从 **错误** 打开它。还原后的堆栈保留生成代码帧，并补充
   源文件路径、行和列；无法还原的帧会显示原因，例如 `missing_artifact`。

上传失败或栈帧一直未还原时，参见
[故障排查](/zh/docs/self-hosting/troubleshooting/#source-map-上传失败)。
