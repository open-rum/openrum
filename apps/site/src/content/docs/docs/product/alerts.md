---
title: Alerts
description: Notify operators when production Issues or health signals need attention.
---

**Applies to:** Alpha / main. Status: Alpha implemented.

Alerts help operators notice recurring production Issues and Instance health problems without watching the Console continuously.

## Typical alert targets

- New or regressing Issues by Fingerprint
- Elevated error impact for a Release or Environment
- Ingest, dependency or lag health signals used by operations runbooks

Configure notification channels carefully. Webhook destinations must be HTTPS and public; credentials are stored as secrets and never returned by admin APIs. See [Threat model](/docs/self-hosting/security/threat-model/).

Related: [Investigation](/docs/product/investigation/), [Troubleshooting](/docs/self-hosting/troubleshooting/).
