---
title: 埋点场景
description: 注册转化、下单、功能采用率、站内搜索、内容互动分别该上报什么，以及各自能查出什么。
appliesTo: Alpha / main
---

每个场景都是「回答一个问题所需的最小事件集」，加上它能支撑的查询。
它们都遵守[自定义事件](/zh/docs/product/analytics/custom-events/)里的那套契约。

## 注册转化

```ts
captureEvent("signup_started", { attributes: { method: "email" } });
captureEvent("signup_completed", { attributes: { method: "email", plan: "free" } });
```

漏斗：`page_view` → `signup_started` → `signup_completed`，窗口 1 小时，维度选
`property:method`。拆分结果直接告诉你哪种注册方式在掉人。

## 下单与收入

```ts
captureEvent("cart_viewed", { attributes: { currency: "USD" } });
captureEvent("checkout_started", { attributes: { currency: "USD", payment: "card" } });
captureEvent("checkout_completed", {
  attributes: { currency: "USD", payment: "card" },
  measurements: { amount: 129.0, items: 3 },
});
```

三步做漏斗拿订单数。金额看 `amount` 这个 measurement：总和是总收入，平均是客单价，
中位数则是少数大额订单会把均值拉偏时该引用的那个。选中它、维度选 `property:payment`，
就能把收入按支付方式拆开。

## 功能采用率

```ts
captureEvent("feature_used", { attributes: { feature: "export_csv", surface: "toolbar" } });
```

一个事件名，功能作为属性。按 `property:feature` 拆分，一次查询就能拿到所有功能的排名；
要是每个功能一个事件名，就得查很多次，而且会把事件名的基数撑爆。

## 站内搜索

```ts
captureEvent("search_performed", {
  attributes: { scope: "docs", has_results: "true" },
  measurements: { results: 12 },
});
```

**绝对不要把搜索词放进属性。** 它是自由输入，会被不可预测地脱敏，而且基数无上限。
属性里放搜索的「形状」，不是内容。

## 内容互动

没有自动的滚动深度或互动时长采集，所以「读完」必须由你在自己的阈值上显式上报一个事件——
读者越过阈值时调一次 `captureEvent("article_finished", { attributes: { category: "guides" } })`。

接下来：[漏斗、路径与留存](/zh/docs/product/analytics/explorations/)讲这些事件能喂给哪些查询。
