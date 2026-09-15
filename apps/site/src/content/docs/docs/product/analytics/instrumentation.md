---
title: Instrumentation recipes
description: What to emit for signup conversion, checkout, feature adoption, search and content engagement, and the query each one enables.
appliesTo: Alpha / main
---

Each recipe is the smallest set of Events that answers one question, plus the query it makes
possible. They all follow the contract in [Custom Events](/docs/product/analytics/custom-events/).

## Signup conversion

```ts
captureEvent("signup_started", { attributes: { method: "email" } });
captureEvent("signup_completed", { attributes: { method: "email", plan: "free" } });
```

Funnel: `page_view` → `signup_started` → `signup_completed`, window 1 hour, dimension
`property:method`. The breakdown tells you which method loses people.

## Checkout and revenue

```ts
captureEvent("cart_viewed", { attributes: { currency: "USD" } });
captureEvent("checkout_started", { attributes: { currency: "USD", payment: "card" } });
captureEvent("checkout_completed", {
  attributes: { currency: "USD", payment: "card" },
  measurements: { amount: 129.0, items: 3 },
});
```

Funnel over the three for order counts. For revenue, read the `amount` measurement: its sum
is total revenue, its average is order value, and its median is the one to quote when a few
large orders would drag the mean. Select it with `property:payment` as the dimension to split
revenue by payment method.

## Feature adoption

```ts
captureEvent("feature_used", { attributes: { feature: "export_csv", surface: "toolbar" } });
```

One event name, the feature as an attribute. Break down by `property:feature` and you get
every feature ranked in one query; a separate event name per feature would need one query
each and would inflate the event-name cardinality.

## Search

```ts
captureEvent("search_performed", {
  attributes: { scope: "docs", has_results: "true" },
  measurements: { results: 12 },
});
```

Never put the query text in an attribute. It is free-form user input, it will be scrubbed
unpredictably, and its cardinality is unbounded. Put the *shape* of the search in attributes.

## Content engagement

There is no automatic scroll or engagement-time measurement, so depth has to be an explicit
Event you emit at your own threshold — `captureEvent("article_finished", { attributes: { category: "guides" } })`
once the reader passes it.

Next: [Funnels, paths and retention](/docs/product/analytics/explorations/) covers the queries
these Events feed.
