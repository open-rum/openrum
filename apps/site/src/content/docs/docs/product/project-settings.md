---
title: Project settings
description: Configure Environments, keys, Origins, sampling, retention and Releases.
---

**Applies to:** Alpha / main. Status: Alpha implemented.

Project settings define how a monitored web product sends and retains telemetry.

## Common settings

- **Environments** such as development, staging and production
- **Client DSNs** with Origin allowlists, rotation and revocation
- **Sampling** for Events, API Requests and errors
- **Retention** for raw and aggregate data
- **Releases** used to associate Source Map Artifacts

## Where to change them

In the Console, open a project and go to **Settings**:

- **General** (`/projects/<id>/settings`) — name, slug, allowed Origins, environment, retention days, and a danger zone to disable or re-enable the project.
- **Client DSN** (`/projects/<id>/settings/keys`) — copy or rotate the Project's automatic default connection string; additional DSNs are advanced configuration.
- **Inbound filters** (`/projects/<id>/settings/filters`) — drop crawler, extension and localhost traffic, plus custom patterns.
- **URL normalization** (`/projects/<id>/settings/url-rules`) — path templates that collapse one route into one row.
- **Scrubbing** (`/projects/<id>/settings/scrubbing`) — regular expressions and attribute keys to redact on top of the built-in list.
- **Quota** (`/projects/<id>/settings/quota`) — the project's own ingest rate limit and what happens above it.
- **Usage and sampling** (`/projects/<id>/usage`) — sampling rates, alongside a preview of the resulting event volume.
- **Alerts** (`/projects/<id>/alerts`) — alert rules for this project.

Two of these settings stop ingestion the moment you save them, and the Console can only
show you the result as an absence of data:

- Removing an Origin makes Ingest reject reports from that site, because it compares the
  `Origin` request header against the allowlist on every request.
- The environment name must match the `environment` passed to the SDK's `init()`. Changing
  it here without shipping a matching SDK release means every report is rejected.

Disabling a project rejects all of its reports but leaves client DSNs intact, so it is the
reversible way to stop a noisy project before deciding whether to delete it.

## Rewriting rules

URL normalization and scrubbing are applied by the Consumer, after the built-in
normalization and redaction have already run. Both add to a floor and neither can switch
it off: the identifier heuristics and the patterns in `internal/privacy` run first
regardless of what a project configures. This is what keeps the SDK's privacy promise
readable from the SDK documentation alone.

Two consequences follow from where they run:

- A change takes effect within about 30 seconds, the Consumer's settings cache window.
- Only data written afterwards is affected. Neither rule set rewrites history, so a row
  that was already stored under a different path, or with text these rules would have
  removed, stays as it is.

A URL rule's pattern is also its result: a path that matches `/orders/:orderId` is stored
as `/orders/:orderId`. Rules are tried top to bottom and the first match wins, so put the
specific template above the broad one.

## Quota

A project's rate limit is counted in requests per second, not events — one request carries
up to 100 events. Leaving it unset uses the instance default.

The over-limit behaviour is a choice between two ways of losing data:

- **Reject** is an exact cap. Whichever callers arrive first in a second get through and
  the rest are refused, so a burst tears sessions in half and the metrics of a session cut
  short are computed from an incomplete page.
- **Sample** sheds by caller instead. A client either passes for the whole window or does
  not, so sessions stay whole and rates remain comparable. The cap becomes approximate in
  exchange, bounded at twice the limit within one window.

Both answer `429`. The difference is which reports are lost, not whether any are.

## Operator guidance

- Prefer opaque account IDs with `setUser`; never send emails as identity.
- Keep Origin allowlists tight in production.
- Treat DSNs as browser-public connection strings protected by Origin and rate limits.
- Configure object storage only when Source Map upload is required.

Related: [Create your first project](/docs/getting-started/create-first-project/), [Data lifecycle](/docs/self-hosting/data-lifecycle/), [Privacy](/docs/self-hosting/security/privacy/).
