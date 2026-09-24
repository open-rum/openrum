---
title: Compared with GA4
description: A feature-by-feature comparison with Google Analytics 4, including the three gaps worth knowing before you migrate.
appliesTo: Alpha
---

Only the GA4 features that matter for a product team are listed. "Partial" means the
capability exists in a narrower form, described in the note.

| GA4 capability | OpenRUM | Notes |
| --- | --- | --- |
| Automatic `page_view` | ✅ | Including SPA route changes as a separate `navigation` kind |
| Automatic click tracking | ✅ | `ui.click`, strict schema, no text content |
| Automatic scroll / file download / outbound click / site search / video | ❌ | Emit Custom Events instead |
| Custom events | ✅ | `captureEvent()` |
| Event parameters | ✅ | `attributes`, ≤ 20, queryable as `property:<key>` |
| Numeric parameters | ✅ | `measurements`, ≤ 20, aggregated as sum, estimated sum, average, min, max, p50 and p90 |
| Key events / conversions | ❌ | No way to mark an event as a conversion; a funnel's last step is the closest equivalent |
| Funnel exploration | ✅ | 2–5 steps, Session-scoped, open funnel |
| Path exploration | ⚠️ Partial | Anchored at Session start only; no backwards paths from an endpoint |
| Cohort / retention | ⚠️ Partial | Weekly only, anonymous visitor ID only |
| Segments and audiences | ❌ | One dimension per query; no saved segments |
| User properties | ❌ | Context tags exist but are not behavior dimensions |
| User-ID reporting | ⚠️ Partial | `setUser()` is stored on the Event, but every behavior metric counts anonymous IDs |
| UTM / campaign attribution | ❌ | Query strings are stripped at normalisation; `source` is the referrer host only |
| Channel groupings | ❌ | No `direct` / `organic` / `paid` classification beyond referrer host |
| Realtime report | ⚠️ Partial | Data freshness is reported and typically under 2 minutes; there is no dedicated realtime view |
| E-commerce reports | ⚠️ Partial | Revenue and order value work through measurements; there is no item-level schema |
| Debug view | ⚠️ Partial | The Event samples endpoint shows recent raw Events for an event name |
| Data export | ✅ | It is your ClickHouse; query it directly |
| Data retention controls | ✅ | Per-Project raw and aggregate retention, physically enforced |
| No cookies, no consent banner | ✅ | Anonymous IDs, no raw input capture, self-hosted |

## What measurement aggregation does and does not cover

Every measurement key gets a sum, a sample-rate-weighted estimated sum, an average, a
minimum, a maximum and the p50 and p90. Any one key can also be split by the selected
dimension, including `property:<key>`, which is how "revenue by payment method" is answered.

Two limits are worth knowing. The aggregate holds **Custom Events only** — no other Event
kind carries measurements — and it starts at the moment the migration runs: a materialized
view cannot fill in history, so Events stored before the upgrade have no measurement
aggregates and never will.

## Identified users are not counted as users

`setUser()` sets `user_id` on every subsequent Event and it is stored. But `uniqueUsers`,
retention cohorts and funnel identity all use the **anonymous** visitor ID. A person on a
phone and a laptop is two users in every behavior report, even when your application knows
they are one account.

## Campaign attribution is absent by design

URL query strings are removed during normalisation, before an Event is stored, so `utm_source`
and friends never reach the database. `source` is the referrer host and nothing more. That is
a deliberate privacy boundary rather than an oversight, but it does mean paid-campaign
reporting has no equivalent here today.
