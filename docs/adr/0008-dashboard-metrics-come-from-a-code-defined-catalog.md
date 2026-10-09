# 0008. Dashboard metrics come from a code-defined catalog

Date: 2026-09-28

Status: Accepted

## Context

The Project overview became a personal dashboard, but its modules could only show the seven
metrics of the original overview response plus three event counts. ClickHouse already held far
more in existing aggregates — Sessions, API outcome splits and latency percentiles, Issues by
error type, Custom Event measurements — and people wanted to combine them freely.

A general query builder would satisfy "freely" but was an explicit non-goal: arbitrary
aggregations over sampled, pre-merged data produce numbers that look authoritative and are
wrong. Summing distinct users across groups, averaging percentiles, adding sample-rate-weighted
counts to unweighted ones, and stacking rates that do not share a denominator are all easy to
express and all misleading.

## Decision

Dashboard modules choose metrics from a catalog defined in code (`internal/catalog`):

- Each metric names its source aggregate, its merge expressions, its unit and its **weighting**
  (scaled back up by the sample rate, or not). It declares the dimensions it can be split by,
  the dimensions across which it adds up, the filters its source supports and whether it forms
  part of a composition group.
- One validation function, `catalog.Validate`, is used by both the query endpoint
  (`GET /api/v1/projects/{id}/metrics/query`) and the saved-configuration validator, so a module
  that saves is a module that runs. The Console keeps a copy of the rules for its editor; a
  shared case matrix and a golden catalog file hold the two to the same verdicts.
- Charts share one unit, and counts with different weighting never share an axis. Only metrics
  that add up across a dimension get an "Other" group, shares or a donut. Only disjoint parts of
  one whole stack.
- A new Issue is one that first appears in the range or returns after 30 days without an
  occurrence. "First seen ever" cannot be answered in a bounded scan and is capped by aggregate
  retention.
- API failures are network failures and 5xx responses; 4xx is shown separately.
- The catalog reads existing aggregates only. Web Vitals are therefore P75 only, because their
  Nullable TDigest states cannot be merged at another level on ClickHouse 25.8.
- Catalog modules are stored as version 2 widgets so an older deployment keeps them verbatim
  instead of rejecting the whole dashboard.

Personal dashboards become several named dashboards per user and Project (`user_dashboards`,
up to 20). They remain personal preferences, and a Project data purge keeps them (ADR 0007).

## Consequences

- Adding a metric is a code change to the catalog, reviewed like any other query, rather than a
  configuration a user can type. Metrics that need a new aggregate need a migration first.
- There is no SQL, script or remote module in a dashboard configuration.
- The Console editor can disable invalid combinations with the same reason a save would give.
