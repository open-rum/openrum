---
title: Dashboards
description: The built-in default dashboard and personal Project dashboards built from a curated metric catalog — metrics, chart types, breakdowns and the rules that keep the numbers honest.
appliesTo: Alpha
---

Every Project opens on a built-in default dashboard. Everyone sees the same default, and
nobody can change it. Each member can also keep several named personal dashboards per
Project, for example "Traffic", "API health" and "Release watch". Changing yours never
changes anyone else's.

## The default dashboard

The default dashboard is defined by OpenRUM and always available at the top of the
dashboard list. It reads top to bottom:

- **Headline numbers:** Sessions, Page Views, users, error rate, API failure rate, and
  LCP, INP and CLS at P75, each with its change against the previous period.
- **Trends:** Sessions against the previous period, Page Views and users, Page Views by
  device, API request outcomes, errors and LCP.
- **What to look at first:** top pages, Page Views by browser and country, errors by
  release, a country overview table, top Issues and the slowest APIs.

The default uses every kind of module at least once, so it also shows what a dashboard
can draw.

You can edit the default like any other dashboard. When you save, OpenRUM creates a new
personal dashboard with your changes and opens it. The default stays exactly as it was, for
you and for everyone else.

## Personal dashboards

Open the dashboard name at the top of the page to switch between the default and your own
dashboards, create one, rename it, reorder the list or delete the current one.

- A new dashboard can start blank, from the default layout, from a template (e-commerce
  overview, traffic and Sessions, performance, API health, error analysis, business metrics)
  or as a copy of the current one. The e-commerce overview shows revenue, orders, average
  order value and the purchase funnel; it expects `view_item`, `add_to_cart`, `begin_checkout`
  and `purchase` Custom Events, with the order total in a `purchase` measurement named
  `amount`.
- Each dashboard keeps its own draft and saves independently. Saving one that changed on
  another device is refused rather than overwritten; reload it and edit again.
- The plain dashboard address opens the dashboard you last used on this device. Each
  dashboard has its own address, and links keep the selected time and Environment.
- Each person can hold up to 20 personal dashboards per Project, each with up to 24
  modules. The default does not count toward the limit.

## Modules

| Module              | Shows                                                                                                    |
| ------------------- | -------------------------------------------------------------------------------------------------------- |
| Stat                | One value for the selected range, with the change against the previous period                            |
| Time series         | One or more metrics over time as area, line or bar, optionally with the previous period as a dashed line |
| Stacked time series | Parts of a whole over time, either several disjoint metrics or one metric split by a dimension           |
| Breakdown           | One metric by dimension as ranked bars, a table or a donut                                               |
| Ranked table        | One metric by group with its change and a small trend per row                                            |
| Metric table        | Several metrics side by side per group, sortable by any column                                           |

The module library is organized by data domain: traffic and Sessions, performance, API,
errors, business metrics and user behavior. Blank modules for building your own are under
**Custom**. Hover the gear at the top of the page to edit the dashboard or add a module.

Modules follow the page's time range and Environment. A module can also carry its own
filters, such as release, route, country, browser, device, event kind or event name,
depending on the metric.

## The metric catalog

Modules choose metrics from a catalog defined by OpenRUM, not from a query editor. Every
metric reads an existing aggregate, so dashboards stay fast and the catalog decides which
combinations are meaningful.

| Group                | Metrics                                                                                             |
| -------------------- | --------------------------------------------------------------------------------------------------- |
| Traffic and Sessions | Page Views, users, Sessions, errors, API Requests, error rate, API failure rate                     |
| Web Vitals           | LCP, INP and CLS at P75                                                                             |
| API                  | Requests, failures, 4xx/5xx/network outcomes and their rates, latency P50/P75/P95                   |
| Errors               | Issue events, affected users and Sessions, active Issues, new Issues                                |
| Business metrics     | Sum, sample-rate-weighted sum, average, minimum, maximum, P50 and P90 of a Custom Event measurement |
| User behavior        | Event count, users and Sessions for page views, route changes, clicks and Custom Events             |

## Compare several events on one chart

To see a payment flow, add a time series, choose **Event count** and split it by **Event
name**. Then pick the events to compare, for example `checkout_started`,
`payment_succeeded` and `payment_failed`. Each event becomes its own line on one axis, in
the order you picked them, up to nine lines.

- Without picked events, the chart shows the most frequent events instead. Filter by event
  kind to keep page views and clicks out of it.
- An event that did not happen in a bucket leaves a gap rather than a zero.
- Event counts may be stacked, because each event is counted once. Users and Sessions may
  not: one person can trigger several of the events.
- Success plus failure does not have to equal the number of starts. Some people abandon a
  flow, so a line chart is usually the honest choice.

## Rules that keep the numbers honest

- **One unit per chart.** Metrics drawn together share a unit. Counts scaled back up by the
  sample rate cannot share an axis with counts that were not.
- **Only parts of a whole stack.** A stacked chart needs metrics that add up, such as the
  three API outcome rates, which share one denominator. Error rates, percentiles and
  distinct users do not add up across groups, so they have no "Other" group, no shares
  and no donut.
- **A 4xx is not a failure.** API failures are network-level failures and 5xx responses.
  The outcome chart shows 4xx separately, as a share of all requests.
- **New Issues** are Issues that first appear in the range, or return after 30 days without
  an occurrence. "First seen ever" cannot be answered in a bounded query and is limited by
  aggregate retention anyway.
- **Error metrics are drawn in five-minute buckets or wider**, because that is how they are
  stored.
- **Web Vitals are P75 only** on dashboards. Other percentiles, FCP and TTFB are on the
  Performance page.
- **Business metrics need a measurement key**, such as `amount`, and can be split by
  country, device, browser, source or a Custom Event attribute. They cannot also be
  filtered by country or browser.
- **Behavior metrics split by one dimension at a time.** Event name, country, device,
  browser, source or a Custom Event attribute can each split a chart, but a chart split by
  country cannot also be filtered by browser.

Every chart follows the shared point budget of about 30 buckets. A bucket with no data is
left empty rather than drawn as zero.

## When a module shows an error

A module whose query would scan too much reports that its query exceeded the budget.
Shorten the time range or add an Environment, release or route filter. Other modules keep
working.
