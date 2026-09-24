---
title: Funnels, paths and retention
description: The three exploration queries, the identity each one counts, and the limits that decide what you can ask.
appliesTo: Alpha
---

Three queries, three different identities. Knowing which one a number counts is what keeps
the three from contradicting each other.

## Funnels

A funnel counts how many **Sessions** reached each step in order.

`POST /api/v1/projects/{projectId}/analytics/funnels/query`

```json
{
  "from": "2026-09-01T00:00:00Z",
  "to": "2026-09-08T00:00:00Z",
  "windowSeconds": 3600,
  "dimension": "country",
  "steps": [
    { "kind": "page_view" },
    { "kind": "custom", "name": "cart_viewed" },
    { "kind": "custom", "name": "checkout_completed" }
  ]
}
```

### Semantics

- **Identity is the Session**, not the visitor. A user who returns tomorrow is a second
  Session and starts the funnel again.
- **Order is enforced, adjacency is not.** Steps must occur with strictly increasing
  timestamps, but unrelated Events in between do not break the funnel.
- **The window applies to the whole funnel**, from the first step to the last, and is one of
  `1800`, `3600` or `86400` seconds.
- Step kinds are `page_view`, `navigation`, `click` and `custom`. Only `custom` takes a
  `name`; the other three match every Event of that kind, so a funnel cannot yet be anchored
  on a *specific* page. Use a Custom Event where you need that.

### Limits

| Limit | Value |
| --- | --- |
| Steps | 2–5 |
| Time range | ≤ 30 days |
| Breakdown values returned | 100, then the query fails with a cardinality error |
| Session samples returned | 20, deepest step first |

The samples bridge to Investigation: open a Session that reached step 2 and stopped, and see
what it did instead.

## Paths

Paths show the most common **first N Events of a Session**, not arbitrary transitions between
any two points.

- `depth` 2–5 Events, `topN` 5, 10 or 20 paths, time range ≤ 7 days
- Each step is labelled `page:<route>`, `navigation:<route>`, `click`, or `event:<name>`
- Routes fall back to the normalised page URL when no Route was supplied
- Only the first 100 Events of a Session are considered before slicing to `depth`

Anchored at the start of the Session, a path answers "where do people go first", not "what
leads to conversion". For the latter, use a funnel.

## Retention

Weekly cohorts over **anonymous visitor IDs**.

- A visitor's cohort is the calendar week (Monday-based) of their first activity *inside the
  selected range*, not their true first-ever visit
- A visitor is retained in week *n* if they produced any `page_view` or Custom Event that week
- Default 8 weeks

Because the cohort is scoped to the query range, widening the range moves visitors between
cohorts. Compare retention across runs only when the range is the same.

Every one of these queries is subject to the
[query budget](/docs/product/analytics/#query-budgets).
