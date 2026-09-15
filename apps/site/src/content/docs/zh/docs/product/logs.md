---
title: 日志
description: 搜索结构化应用日志，结合会话和页面上下文排查问题。
---

**适用于：** Alpha / main，已实现。

「日志」用于浏览应用诊断消息，与业务事件和错误 Issue 分开。顶部时间、环境控制整个页面；使用级别和搜索条件缩小排查范围。图表与列表占满内容区，不显示通用维度筛选侧栏。

## 发送日志

```ts
import { init, logger, setUser } from "@openrum/browser";

init({
  dsn: "你的项目 DSN",
  captureConsole: ["warn", "error"], // 可选，默认不转发 console。
});
setUser("customer-123"); // 业务用户 ID，不要传邮箱。
logger.info("checkout started", { "order.id": "order-123", items: 3 });
logger.error("payment failed", { "error.code": "UPSTREAM_TIMEOUT" });
```

支持 `trace`、`debug`、`info`、`warn`、`error`、`fatal`，也可使用 `client.logger`。日志沿用 `eventSampleRate`，在有界队列中使用低优先级；error/fatal 日志不会创建 Issue。`beforeSendLog` 可改写日志或返回 `null` 丢弃。

主动调用 `logger.*` 就表示上报该条日志；仅初始化 SDK 不会采集应用日志。`captureConsole` 独立开启所列 console 方法的转发，不再依赖 `enableLogs`。旧的 `enableLogs` 配置仍可保留以兼容现有项目，但不再控制这两条路径。

退出登录时调用 `setUser(undefined)`。每条日志保留产生当时的身份，不按上传时的用户覆盖，也不会给登录前的日志补填用户。当前 `setUser` 仅接收 ID，不接收姓名、邮箱等对象。详情展示用户 ID 和匿名访客 ID，并提供「同用户日志」「同访客日志」快捷搜索。

不要主动记录凭证或个人信息。消息及基础类型属性会限长、脱敏，并再次应用服务端和项目自定义规则；模式匹配脱敏不等于完全匿名化。console 转发保留原输出，不序列化对象。

## 搜索与排查

- `payment failed`：正文包含这两个关键词，区分大小写。
- `severity:error message:"payment failed"`：级别与短语。
- `logger:payment order.id:order-123`：来源和精确属性值。
- `country:CN device:mobile route:/checkout`：国家、设备和路由，也支持 `browser`、`release` 条件。
- `attributes.level:custom`：显式查询与内置字段同名的属性。
- `session_id:<uuid>` / `trace_id:<id>`：关联日志。
- `user.id:"customer-123"`：精确匹配用户 ID，也支持 `user_id`、`userId`；直接输入文字只匹配消息正文。
- `anonymous_user_id:"visitor-id"`：按匿名访客查找，也可定位未设置用户 ID 的日志。
- `attributes.user.id:custom`：查询名为 `user.id` 的自定义属性，而不是 SDK 用户身份。

多个条件必须同时满足，最多 12 个条件、1,024 字符；有空格的值用双引号包裹。暂不支持 OR、通配符展开或数值比较。

点击消息打开详情侧栏，可以查看全部属性、按属性筛选、查看同会话日志或跳转关联会话。「导出本页」只下载当前页 JSONL。趋势图显示实际采集数量，不进行采样估算；查询最长 30 天，超过扫描预算请缩短时间重试。

## 功能边界与升级

仅在事件信封携带 Trace 上下文时显示关联信息；浏览器 SDK 不自动采集分布式追踪。本版不含服务端标准输出采集、实时尾随、日志告警或聚合查询构建器。

先执行 ClickHouse `0008_logs` 迁移，再部署新版采集、消费和 API 服务，最后升级 SDK 并开始发送日志。旧版采集服务可能拒绝包含日志的批次。本地数据构造器提供「结构化应用日志」预设。
