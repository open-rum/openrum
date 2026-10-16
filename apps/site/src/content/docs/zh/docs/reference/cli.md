---
title: 命令行
description: "@openrum/cli 提供的 openrum 命令：命令、选项、环境变量和退出码。"
appliesTo: "@openrum/cli 0.1.0"
---

`@openrum/cli` 会安装 `openrum` 命令。它用来上传你自己构建产物中的 Source Map；在 OpenRUM 仓库的检出目录里，它也是本地开发栈工具的入口。需要 Node.js 20 或更高版本。

```sh
pnpm add -D @openrum/cli
pnpm exec openrum --help
```

用 `npm install --save-dev @openrum/cli` 或 `yarn add -D @openrum/cli` 也一样；`npm install --global @openrum/cli` 会把 `openrum` 装到全局路径。

## 命令

```text
openrum <command> [options]
```

| 命令 | 作用 |
| --- | --- |
| `openrum sourcemaps upload` | 把构建产物中的隐藏 Source Map 上传到 OpenRUM 的 Release |
| `openrum help` | 打印命令列表 |
| `openrum --version` | 打印包版本（`-v` 和 `version` 效果相同） |
| `openrum dev`、`up`、`status`、`logs`、`restart`、`seed`、`stop`、`down`、`reset` | 管理本地开发栈，只能在仓库的检出目录里使用 |

## `openrum sourcemaps upload`

它读取构建输出里的所有 `.map` 文件，创建（或复用）Release，上传这些 Map，并把它们连同 `sourceMappingURL` 注释一起从构建产物里删除。效果与 Vite 插件相同；整个流程、Release 匹配方式，以及栈帧为什么还原不出来，见 [Source Map](/zh/docs/sdk/source-maps/)。

```sh
OPENRUM_BASE_URL=https://rum.example.com \
OPENRUM_PROJECT_ID=00000000-0000-4000-8000-000000000000 \
OPENRUM_RELEASE=storefront@1.8.0 \
OPENRUM_UPLOAD_TOKEN=orut_... \
pnpm exec openrum sourcemaps upload --out-dir dist --url-prefix static/app/
```

每个值都来自一个参数或一个环境变量，**参数优先于环境变量**。在终端里运行 `openrum sourcemaps upload --help` 可以看到同样的表。

| 参数 | 环境变量 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `--base-url` | `OPENRUM_BASE_URL` | 无 | OpenRUM API 的来源，例如 `https://rum.example.com`。必填 |
| `--project-id` | `OPENRUM_PROJECT_ID` | 无 | 必填 |
| `--release` | `OPENRUM_RELEASE` | 无 | 必须与 SDK 的 `release` 一致。必填 |
| `--dist` | `OPENRUM_DIST` | 无 | 使用时必须与 SDK 的 `dist` 一致 |
| `--commit-sha` | `OPENRUM_COMMIT_SHA` | 无 | 记录在 Release 上 |
| `--out-dir` | `OPENRUM_OUT_DIR` | `dist` | 扫描 `.map` 文件的构建输出目录 |
| `--url-prefix` | `OPENRUM_URL_PREFIX` | 空 | 放在每个文件路径前面的 URL 路径，例如 `static/app/`。见 [Artifact 命名](/zh/docs/sdk/source-maps/#artifact-命名与-urlprefix) |
| `--replace` | `OPENRUM_REPLACE=true` | 关闭 | 覆盖已上传、同名但内容不同的 Map |
| `--token` | `OPENRUM_UPLOAD_TOKEN` | 无 | [Source Map 上传令牌](/zh/docs/sdk/source-maps/#创建上传令牌) |
| `--help` | 无 | | 打印选项 |

令牌建议用环境变量传入，这样它不会出现在进程列表和 shell 历史里。并行上传数和重试次数固定为 4 和 2，只有插件和库可以调整。

早先使用的 Console 会话变量 `OPENRUM_SESSION` 和 `OPENRUM_CSRF_TOKEN` 仍然可用但已弃用，请换成上传令牌。

## 本地开发栈

`dev`、`up`、`status`、`logs`、`restart`、`seed`、`stop`、`down` 和 `reset` 由 OpenRUM 仓库 `cmd/openrum` 里的 Go 工具实现。在检出目录里，`openrum <command>` 会找到仓库根目录，并在那里运行 `go run ./cmd/openrum <command>`，所以需要安装 Go、带 Compose v2 的 Docker，`dev` 还需要 pnpm。在其他地方，它会说明这些命令只能在检出目录里使用，并以状态码 `1` 退出。命令本身的说明见[本地开发](/zh/docs/getting-started/local-development/#openrum-命令)。

## 退出码

| 退出码 | 含义 |
| --- | --- |
| `0` | 命令成功 |
| `1` | 上传失败或选项无效，或本地开发栈命令失败，或在检出目录之外运行。被转交的命令会以 Go 工具的退出码退出 |
| `2` | 用法错误：没有命令、未知命令，或未知的 `sourcemaps` 子命令 |
