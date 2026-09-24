---
title: 故障排查
description: 排查本地启动、事件缺失、登录和 Source Map 问题。
---

**适用于：** Alpha。

## 本地 Compose 无法健康启动

1. 确认 Docker、Compose v2 可用，且 `4173`、`5433`、`8123`、`9000`、`9092`、`6379` 未占用。
2. 查看服务状态：

```sh
docker compose -f deploy/compose/docker-compose.yml ps
docker compose -f deploy/compose/docker-compose.yml logs --tail=100 api ingest consumer worker web
```

3. 在 `deploy/compose/.env` 覆盖冲突端口。
4. 只有明确要清空本地演示数据时才执行 `docker compose -f deploy/compose/docker-compose.yml down -v`。

## Console 可以打开但登录失败

- 使用与 `PUBLIC_BASE_URL` 一致的 `http://127.0.0.1:4173`。
- 运行 `curl --fail http://127.0.0.1:4173/health/ready` 检查 API Readiness。
- 本地演示账号为 `demo@openrum.local` / `OpenRUM-demo-2026!`，仅用于本地评估。

## 事件没有出现

1. 检查 Browser SDK `dsn` 与项目允许的 Origin。
2. 检查 Ingest 日志和项目 Key 的 Origin Allowlist。
3. 确认 Kafka、Consumer 和 ClickHouse 健康；首次启动等待演示数据完成。
4. 在较宽时间范围查看“事件”，再用相同 `session_id` 查看“会话”。

| 现象 | 可能原因 | 下一步 |
| --- | --- | --- |
| 行为图表为空 | Seed 未完成或 ClickHouse 异常 | 等待并检查 Consumer/ClickHouse |
| 会话没有错误 | 该会话确实无错误事件 | 在演示项目筛选带错误的会话 |
| Issue 无源码栈 | 未配置可选对象存储 | 属于预期，核心监控仍可用 |
| API 面板为空 | 未捕获 fetch/XHR 或采样关闭 | 从示例应用触发请求 |

Source Map 上传问题参见 [Source Map](/zh/docs/sdk/source-maps/) 和[对象存储](/zh/docs/self-hosting/object-storage/)。
仍无法解决时，提交 Issue 并附 Compose 状态、Request ID 和脱敏日志。
