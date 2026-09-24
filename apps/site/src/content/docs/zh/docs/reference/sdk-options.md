---
title: SDK 选项
description: "@openrum/browser 全部初始化选项的生成参考。"
appliesTo: "@openrum/browser 0.1.0"
---

<!-- GENERATED: scripts/docs/generate-reference.mjs -->

本页根据 `packages/browser-sdk/src/client.ts` 生成，请勿手工修改。以下选项传给 `init()`，接入方式见 [Browser SDK](/zh/docs/sdk/browser/)。

| 选项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `dsn` | `string` | 必填 | 包含 Ingest URL 和只写 Client Key 的公开 Project 连接串 |
| `environment` | `string` | `"production"` | 区分生产、测试等 Environment |
| `release` | `string` | 未设置 | 映射调用栈时必需，必须与上传产物的 Release 一致 |
| `dist` | `string` | 未设置 | 区分共享同一 Release 的构建 |
| `eventSampleRate` | `number` | `1` | Page View、交互、Custom Event 和显式启用的 Log |
| `apiSampleRate` | `number` | `0.2` | fetch 和 XHR 耗时 |
| `errorSampleRate` | `number` | `1` | 错误和未处理 Promise 拒绝 |
| `captureClicks` | `boolean` | `true` | 采集经过隐私处理的交互元素描述 |
| `enableLogs` | `boolean` | 忽略 | 仅兼容旧配置；logger 和 `captureConsole` 分别显式启用 |
| `captureConsole` | `ConsoleLogLevel[]` | 未设置 | 可选 `debug`、`log`、`info`、`warn`、`error` |
| `beforeSendLog` | `(log) => log \| null` | 未设置 | 转换或丢弃 Log，最终隐私清洗仍会执行 |
| `flushIntervalMs` | `number` | `5000` | `pagehide` 和重新联网时也会 Flush |
| `beaconEndpoint` | `string` | 未设置 | 预认证 `sendBeacon` URL，不携带 DSN 凭据 |
| `configEndpoint` | `string \| false` | DSN Origin | 从 `/api/v1/sdk/config` 获取远程采样；`false` 禁用 |
| `integrations` | `Integration[]` | 内置集合 | 替换而不是追加默认 Integration |

0–1 之外的采样率会被忽略并使用内置默认值。三种采样按 Session 独立且确定性决策，不会把同一 Session 切成两半。

`configEndpoint` 响应会缓存；无效远程配置不会覆盖本地采样率。传入 `integrations` 会完全替换默认集合，缺少 Page Integration 时将关闭自动 Page View。
