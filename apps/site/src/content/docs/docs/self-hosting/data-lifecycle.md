---
title: Data lifecycle
description: Retention, expiry and controlled cleanup for raw and aggregate telemetry.
appliesTo: Alpha
---

OpenRUM retains raw Events and aggregates according to Project policy. Lifecycle jobs must support preview, audit and rate limits before historical cleanup.

## Principles

- Raw telemetry and aggregates expire by policy; do not keep unbounded Event history by default.
- Cleanup actions are explicit operator workflows with preview and audit records.
- Kafka and Redis are not the long-term system of record for analytics queries.
- Optional Source Map Artifacts follow object-storage lifecycle rules separate from Event retention.

Configure retention when creating or updating a Project. For backups of control-plane and Event stores, see [Backup and restore](/docs/self-hosting/backup-restore/). Privacy defaults are summarized in [Privacy](/docs/self-hosting/security/privacy/).
