---
title: Project settings
description: Configure Environments, keys, Origins, sampling, retention and Releases.
---

**Applies to:** Alpha / main. Status: Alpha implemented.

Project settings define how a monitored web product sends and retains telemetry.

## Common settings

- **Environments** such as development, staging and production
- **Write keys** with Origin allowlists, rotation and revocation
- **Sampling** for Events, API Requests and errors
- **Retention** for raw and aggregate data
- **Releases** used to associate Source Map Artifacts

## Operator guidance

- Prefer opaque account IDs with `setUser`; never send emails as identity.
- Keep Origin allowlists tight in production.
- Treat write keys as browser-public credentials protected by Origin and rate limits.
- Configure object storage only when Source Map upload is required.

Related: [Create your first project](/docs/getting-started/create-first-project/), [Data lifecycle](/docs/operations/data-lifecycle/), [Privacy](/docs/security/privacy/).
