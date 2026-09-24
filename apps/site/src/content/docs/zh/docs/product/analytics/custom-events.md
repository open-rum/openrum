---
title: 自定义事件
description: 怎么上报一个自定义事件、Ingest 对事件名和载荷的限制，以及 ui.click 保留 schema。
appliesTo: Alpha
---

自定义事件是你决定记录下来的产品里程碑。页面访问和点击会自动上报，
其余一切对你的产品有特定含义的东西，都通过 `captureEvent` 进来。

## 怎么发

```ts
import { captureEvent } from "@openrum/browser";

captureEvent("checkout_completed", {
  attributes: { plan: "pro", currency: "USD", coupon: "none" },
  measurements: { amount: 129.0, items: 3 },
});
```

`attributes` 是字符串，用来**分组**；`measurements` 是数字，用来**求和**。两者都会被聚合，
只是轴不同：属性变成可拆分的 `property:<key>` 维度，measurement 则会算出总和、平均、
最小值、最大值和分位数。把「类别」放属性里，把「数量」放 measurement 里。

## 事件名和载荷必须满足的规则

SDK 和 Ingest 两侧都会执行。SDK 在本地直接丢弃；Ingest 会裁剪送达的内容，
并给被裁剪过的事件打上 `pii_scrubbed` 标记。

| 规则 | 限制 | 违反时 |
| --- | --- | --- |
| 事件名 | 1–80 字符 | SDK 直接丢弃 |
| 保留前缀 | 不能是 `openrum.*` | SDK 直接丢弃 |
| 属性数量 | 每条事件 ≤ 20 个 | 多余的 key 被丢弃 |
| 属性 key | ≤ 64 字符 | 截断 |
| 属性 value | ≤ 512 字符 | 截断 |
| measurements 数量 | 每条事件 ≤ 20 个 | 多余的 key 被丢弃 |

脱敏叠加在上面这些尺寸限制之上。key 名里含有 `password`、`token`、`secret`、`authorization`、
`cookie`、`accessKey` 以及若干类似片段的，整个 key 会被移除；值看起来像邮箱、Bearer、JWT
或通过 Luhn 校验的卡号的，会被替换成脱敏标记。

想追加自己的正则和敏感 key，在**项目设置 → 脱敏**里加。它们叠加在内置那套之上，且不能把内置的关掉。

## 命名

用 `snake_case` 的过去式动词，按对象分组：`checkout_completed`、`trial_started`、
`report_exported`。事件名必须是**固定字符串**——绝对不要把 ID 或变体拼进去。
`captureEvent(\`order_${id}_done\`)` 是每个订单一个事件名；
`captureEvent("order_completed", { attributes: { channel: "web" } })` 才是一个可分组的指标。

## `ui.click` 是保留 schema

行为集成会自动上报 `ui.click`，Ingest 对它执行一套严格的结构约束。只有这几个属性能活下来：

- `element` —— `a`、`button`、`input`、`select`、`textarea`、`summary`、`custom` 之一。**必填**，识别不出元素的事件会被直接拒绝。
- `role` —— `button`、`link`、`menuitem`、`tab` 之一
- `input_type` —— `button`、`checkbox`、`radio`、`reset`、`submit`、`file` 之一，且只在 `element` 是 `input` 时保留
- `name` —— 脱敏后的标签，≤ 64 字符

没有文本内容，没有输入值，没有选择器。这就是点击采集可以默认开启、而不会采到用户输入了什么的原因。

接下来：[埋点场景](/zh/docs/product/analytics/instrumentation/)把这些规则套到团队真正会问的分析上。
