---
title: Analytics
description: The behavior event model, the dimensions and metrics every Analysis query is built from, and the budget that decides whether a query runs.
appliesTo: Alpha
---

Analysis answers what users did across a Project and Environment. It shares one dataset with
error monitoring, which is the point: the Session that converted and the Session that threw
are the same rows.

This page is the model everything else rests on. Once it makes sense, go to
[Custom Events](/docs/product/analytics/custom-events/) to send your own, or
[Funnels, paths and retention](/docs/product/analytics/explorations/) to query what you have.

## What Analysis sees

Analysis reads four **event kinds**, derived from the stored Event rather than declared by
the SDK:

| Kind | Comes from | `event_name` |
| --- | --- | --- |
| `page_view` | A Page View whose navigation type is not `route_change` | `page_view` |
| `navigation` | A Page View whose navigation type is `route_change` (SPA route change) | `navigation` |
| `click` | The automatic `ui.click` Custom Event | `click` |
| `custom` | Any other Custom Event | your event name |

:::caution[Errors, Web Vitals and API Requests are not behavior events]
The behavior aggregate is built from `page_view` and `custom` Events only. Errors, Web Vitals
and API Requests are stored on the same Events table but are excluded from behavior metrics,
funnels, paths and retention. Analyse them through [Performance](/docs/product/performance/),
[API monitoring](/docs/product/api-monitoring/) and Issues instead.
:::

Events flagged `synthetic` — the Demo seed and test Events — are excluded from every behavior
query, so a seeded Instance never reports Demo traffic as real.

## Dimensions

Every behavior metric can be broken down by one dimension:

| Dimension | Value | Derived from |
| --- | --- | --- |
| `country` | Country code, or `unknown` | The Session's first Event |
| `device` | `desktop`, `mobile`, `tablet`, `bot`, `unknown` | User agent |
| `browser` | Browser name, or `unknown` | User agent |
| `source` | Referrer host, or `direct` | Referrer domain |
| `property:<key>` | Your attribute value, or `(not set)` | Custom Event attributes |

`<key>` must match `^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$`.

:::note[Only Custom Event attributes become properties]
`property:` dimensions are materialised from the `attributes` of **Custom Events**. Context
tags set through `setTag()` ride along on every Event as `tag.<key>` but are not exposed as
behavior dimensions, so you cannot currently break Page Views down by a context tag. Put the
value on the Custom Event if you need to group by it.
:::

## Metrics

| Metric | Meaning |
| --- | --- |
| `events` | Distinct Event IDs, approximate (`uniqCombined64`) |
| `estimated` | Events weighted by `1 / sampleRate`, i.e. the estimated true count |
| `uniqueUsers` | Distinct anonymous visitor IDs, approximate |
| `uniqueSessions` | Distinct Session IDs, approximate |

Every count is approximate by construction, and the response carries `approximate: true` so the
Console can say so. Read `estimated` when you have lowered a sample rate and want the
real-world figure; read `events` when you want what was actually stored.

## Query budgets

Analysis queries are rejected before they run when they would scan too much. A rejection
returns `422 QUERY_TOO_EXPENSIVE`.

Cost rises with the time range and with `property:` dimensions, which cost four times a
built-in one. It falls when you filter, so the fix is usually one of:

- shorten the range
- add an Environment filter (÷4)
- add an event kind or name filter (÷4, behavior queries only)
- switch from a `property:` dimension to a built-in one

## Next

- [Custom Events](/docs/product/analytics/custom-events/) — the payload contract and the reserved `ui.click` schema
- [Instrumentation recipes](/docs/product/analytics/instrumentation/) — signup, checkout, feature adoption, search
- [Funnels, paths and retention](/docs/product/analytics/explorations/) — the three exploration queries and their limits
- [Compared with GA4](/docs/product/analytics/ga4/) — feature-by-feature, including the gaps

Related: [Investigation](/docs/product/investigation/), [Domain model](/docs/getting-started/domain-model/), [Browser SDK](/docs/sdk/browser/).
