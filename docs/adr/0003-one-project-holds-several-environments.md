---
status: accepted
---

# One project holds several environments

A Project represents one monitored web product and accepts a bounded set of
Environments. Production, canary, test, and development deployments therefore
remain within one Project rather than becoming separate Projects.

The former `projects.environment` column remains the default Environment for
backward compatibility. Membership lives in `project_environments`, and Ingest
accepts an envelope only when `context.environment` belongs to that set.

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
- **The Console already asks for it.** The project switcher renders an
  environment selector and puts the choice in the URL and in saved context.
- **Alert rules already carry one.** Each rule names the environment it watches.

So the missing piece is not the data model or the reader. It is the writer: the
control plane holds one name, and Ingest enforces equality against it.

Before this decision, the Console built its selector from hard-coded names. It
could therefore offer an environment the project had never accepted, while
Ingest rejected every report sent under that name. The accepted implementation
replaces that literal with the project's registered Environment set.

## Considered options

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

A Project accepts a set of Environments. Ingest checks membership instead of
equality. Everything downstream already understands the event Environment
column.

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

## Decision

B, with the isolation loss stated rather than papered over. The reason is not
that B is cheap — though it is cheaper than it looks, because storage, queries
and the Console are already environment-aware — but that A leaves the system
internally inconsistent in a way users can see: a selector that offers
environments the ingest will reject, and an environment facet on the issue list
that can only ever have one value.

The related decisions are:

- **Quota and retention remain per Project.** This keeps the Project as the
  operational and cost boundary for Alpha. Environment-specific limits can be
  added later if real usage shows that noisy non-production traffic needs an
  independent budget.
- **Issue grouping spans Environments.** Fingerprints remain Environment-neutral
  so a problem found in test can be followed into production. Readers must apply
  the Environment filter when they need a production-only count.

## Consequences

Ingest gains a per-project set on its hot path. It is already caching the
project row for 30 seconds, so the cost is a slightly larger cache entry rather
than a lookup, but the set has to be bounded — an unbounded environment list is
a way to make that cache entry arbitrarily large from outside.

The `ENVIRONMENT_MISMATCH` rejection becomes rarer and therefore more
informative: today it fires whenever anybody points a staging build at the wrong
project, which is common enough that it reads as noise. After B it means the
name is genuinely not registered.
