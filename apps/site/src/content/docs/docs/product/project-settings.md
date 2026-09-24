---
title: Project settings
description: Configure Environments, keys, Origins, sampling, retention and Releases.
---

**Applies to:** Alpha. Status: Alpha implemented.

Project settings define how a monitored web product sends and retains telemetry.

## Common settings

- **Environments** such as development, staging and production
- **Client DSNs** with Origin allowlists, rotation and revocation
- **Sampling** for Events, API Requests and errors
- **Retention** for raw and aggregate data
- **Releases** used to associate Source Map Artifacts

## Where to change them

In the Console, open **Settings** and use the **Project** scope. Every settings address
names its scope in the path, so a link is unambiguous about which of account, organization,
project or instance it belongs to:

- **General** (`/settings/project/<id>/general`) — name, slug, allowed Origins, environment, retention days, and a danger zone to disable or re-enable the project.
- **Onboarding** (`/projects/<id>/onboarding`) — copy the Project's default DSN and platform-specific integration code.
- **Data management** — one entry for sampling, rate limits, inbound filters, URL normalization and privacy scrubbing. Switch between the page's tabs; each setting saves independently and applies across the Project's environments.
- **Usage statistics** (`/settings/project/<id>/usage`) — accepted volume, estimated source volume and processing outcomes, with CSV export. Sampling configuration is separate from this report.

### Data management tabs

| Tab | Purpose | Address |
| --- | --- | --- |
| Sampling | Configure the proportion retained by the SDK for Events, API Requests and errors before reporting. Preview the impact using the last seven days across all event types. | `/settings/project/<id>/sampling` |
| Rate limits | Limit Ingest requests per second and choose the over-limit strategy; separate from routine SDK sampling. | `/settings/project/<id>/quota` |
| Inbound filters | Exclude crawlers, extensions, localhost traffic and custom patterns. | `/settings/project/<id>/filters` |
| URL normalization | Group dynamic addresses under stable route templates. | `/settings/project/<id>/url-rules` |
| Privacy scrubbing | Add sensitive keys and patterns to the built-in redaction rules. | `/settings/project/<id>/scrubbing` |

An unavailable, empty or query-capped usage estimate does not block sampling configuration.
**Alerts** (`/projects/<id>/alerts`) remains a separate project navigation entry.

The previous addresses under `/projects/<id>/settings/…` still work and redirect to the
scoped ones, so existing bookmarks and links do not break. Old `/projects/<id>/usage`
links redirect to Usage statistics while preserving their time and event-type filters.

Two of these settings stop ingestion the moment you save them, and the Console can only
show you the result as an absence of data:

- Removing an Origin makes Ingest reject reports from that site, because it compares the
  `Origin` request header against the allowlist on every request.
- The environment name must match the `environment` passed to the SDK's `init()`. Changing
  it here without shipping a matching SDK release means every report is rejected.

Disabling a project rejects all of its reports but leaves client DSNs intact, so it is the
reversible way to stop a noisy project before deciding whether to delete it.

## Delete all Project data

The General page also provides **Delete all Project data** for resetting collected data without
recreating the SDK integration. It permanently removes Events, Sessions, errors, logs, API and
performance data, usage aggregates, alert evaluation history, Releases and Source Maps. The
Project itself, environments, client DSNs, Origins, sampling and retention settings, alert rules
and audit history remain.

This operation is deliberately separate from Project deletion and has three safeguards:

1. An Organization Owner must disable the Project first, which stops new reports.
2. The Owner must type the exact Project name before the Console submits the request.
3. The Project cannot be re-enabled while deletion is queued, running, retrying or verifying.

Deletion runs asynchronously. After the analytics store is empty, OpenRUM waits for one minute
and checks it again so reports already moving through the pipeline cannot silently reappear.
The Project stays disabled after the job completes; review the result before enabling it again.

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

## Rate limits

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

For the IP guard, Redis fallback, response headers, sizing formula and troubleshooting workflow, read [Rate limits](/docs/product/rate-limits/).

## Operator guidance

- Prefer opaque account IDs with `setUser`; never send emails as identity.
- Keep Origin allowlists tight in production.
- Treat DSNs as browser-public connection strings protected by Origin and rate limits.
- Configure object storage only when Source Map upload is required.

Related: [Create your first project](/docs/getting-started/create-first-project/), [Data lifecycle](/docs/self-hosting/data-lifecycle/), [Privacy](/docs/self-hosting/security/privacy/).
