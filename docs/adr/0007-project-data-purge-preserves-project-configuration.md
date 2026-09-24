# 0007. Project data purge preserves project configuration

Date: 2026-09-22

Status: Accepted

## Context

Operators sometimes need to remove every collected record from a Project without rebuilding
its SDK integration, DSNs, alert rules or configuration. Reusing Project deletion would remove
those control-plane resources as well and would make an accidental click much harder to recover
from. Deleting ClickHouse rows also takes time and may race with reports already moving through
Kafka and the Consumer.

## Decision

Project settings expose a separate **Delete all Project data** operation with these rules:

- The Project must be disabled before the request is accepted and remains disabled afterwards.
- Only an Organization Owner can request it, after typing the exact Project name.
- The operation is asynchronous. While it is queued, running, retrying or verifying, the Project
  cannot be re-enabled or submitted again.
- It deletes ClickHouse telemetry and aggregates, PostgreSQL Issue state, alert evaluation
  history and Releases, and the Source Map objects referenced by those Releases.
- It preserves the Project, environments, client DSNs, Origin rules, sampling and retention
  settings, alert rules, dashboards, members and audit history.
- After ClickHouse first reports zero rows, the Worker waits one minute and checks again before
  completing. This catches late reports that were already in the ingest pipeline.
- Request and completion are recorded in the audit log. Failures remain visible and can be
  retried after the job reaches a terminal failed state.

## Consequences

This operation is distinct from deleting a Project. It gives less experienced operators a safe,
guided reset path while keeping their integration usable. It is not instantaneous: ClickHouse
mutations, object-store deletion and the empty confirmation window determine completion time.
The control plane must therefore keep the job state and prevent writes from being re-enabled
during that window.
