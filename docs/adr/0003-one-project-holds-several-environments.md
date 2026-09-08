---
status: proposed
---

# One project holds several environments

A project carries exactly one environment today. `projects.environment` is a
single `VARCHAR(64)`, and Ingest refuses any envelope whose
`context.environment` is not equal to it
(`services/ingest/internal/handler.go`). Running staging next to production
therefore means creating a second project, with its own write keys, quota,
retention policy, filters and issue history.

This document exists to make that a decision rather than an accident. It has
not been decided yet.

## What is already multi-environment

The single-value field is narrower than the rest of the system, which is the
reason the question is worth asking now rather than later.

- **Storage is already per environment.** `environment` is a column on
  `rum_events` and a key in the `ORDER BY` of every aggregate: project metrics,
  API metrics, issue metrics and behavior metrics
  (`migrations/clickhouse/0002`, `0003`, `0006`).
- **The query layer already filters on it.** `internal/query` accepts an
  optional environment on analytics, APIs, issues, performance, funnels, paths,
  retention and sessions, and the issue list already produces an environment
  facet.
- **The Console already asks for it.** `AnalysisContextBar` renders an
  environment selector and puts the choice in the URL and in saved context.
- **Alert rules already carry one.** Each rule names the environment it watches.

So the missing piece is not the data model or the reader. It is the writer: the
control plane holds one name, and Ingest enforces equality against it.

There is a visible symptom of the mismatch. The Console builds its selector as
`[...new Set([project.environment, "production", "test"])]` — it offers two
environments the project may never have accepted, and Ingest would have rejected
every report from them. Whichever option is chosen, that list should come from
the project rather than from a literal.

## The two options

### A. Keep one environment per project

Nothing changes. Staging is a separate project.

This is coherent as long as separation is what you want: a staging project can
have a short retention, a low quota and aggressive filters without any of that
touching production, and a noisy pre-release cannot exhaust the production
quota, because the quota is per project (see the ingest quota work).

What it costs is comparison. The two projects have unrelated issue
fingerprint histories, so an error first seen in staging appears as new again in
production. Releases, filters, URL templates and scrub rules are configured
twice and drift. The Console's project switcher grows two entries per product.
And the environment selector described above stays a decoration.

### B. A project accepts a set of environments

`projects.environment` becomes a set. Ingest checks membership instead of
equality. Everything downstream already understands the column.

Concretely:

- **Schema.** A `project_environments` table keyed by `(project_id, name)`
  rather than a JSON array, because Ingest reads it on the authentication path
  and a set with a uniqueness constraint is what expresses "these are the names
  we accept". Migration seeds one row per existing project from the current
  value, so no project changes behaviour on upgrade.
- **Ingest.** `access.Project.Environment` becomes a set on
  `metadata.ProjectKeyAccess`, loaded by the same key lookup that already
  selects the project row and cached for the same 30 seconds. The comparison in
  the handler becomes a membership test; the `ENVIRONMENT_MISMATCH` rejection
  stays, and stays as valuable — it is what catches an SDK shipped with a
  typo'd environment.
- **Console.** The selector's option list comes from the project. A default
  environment is still needed, because a project with three environments has to
  open on one of them; the natural choice is to keep the existing column as the
  default and let the table hold the rest.
- **Everything else.** No query change, no ClickHouse migration, no SDK change.

What it costs is that a project stops being an isolation boundary. One quota,
one retention policy, one filter set and one set of write keys now cover
production and staging together. A pre-release that floods the ingest spends the
production project's quota. Whether that is acceptable depends on whether the
environments belong to one team looking at one product, which is the case B is
for.

## Recommendation

B, with the isolation loss stated rather than papered over. The reason is not
that B is cheap — though it is cheaper than it looks, because storage, queries
and the Console are already environment-aware — but that A leaves the system
internally inconsistent in a way users can see: a selector that offers
environments the ingest will reject, and an environment facet on the issue list
that can only ever have one value.

If B is chosen, two things should be decided at the same time rather than
discovered later:

- **Whether the quota is per project or per environment.** Per project is the
  smaller change and the one that matches "these are one product". Per
  environment is what a team would want the first time staging costs them
  production data, and retrofitting it means the quota key stops being the
  project id.
- **Whether issue grouping spans environments.** A fingerprint is computed from
  the error, not the environment, so an issue would span them by default and the
  facet would separate them on demand. That is the useful behaviour, but it also
  means a staging-only error shows up in the production issue count unless the
  reader filters — which is exactly the ambiguity the facet exists to resolve.

## Consequences if B is accepted

Ingest gains a per-project set on its hot path. It is already caching the
project row for 30 seconds, so the cost is a slightly larger cache entry rather
than a lookup, but the set has to be bounded — an unbounded environment list is
a way to make that cache entry arbitrarily large from outside.

The `ENVIRONMENT_MISMATCH` rejection becomes rarer and therefore more
informative: today it fires whenever anybody points a staging build at the wrong
project, which is common enough that it reads as noise. After B it means the
name is genuinely not registered.
