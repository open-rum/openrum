---
title: Security and privacy defaults
description: Collection boundaries, RBAC, CSRF and Secret handling.
appliesTo: Alpha
---

## Collection boundaries

The Browser SDK excludes query strings, bodies, headers, cookies and raw input values by default. Sensitive-looking values are scrubbed client-side and the ingest service validates bounded schemas again.

Do not send email, phone, payment data, authentication tokens or free-form user text in Custom Events. Prefer opaque account identifiers with `setUser`.

## Authentication and authorization

Authentication uses server-side sessions, HttpOnly cookies, same-origin CSRF validation and service-side RBAC. Instance roles and Organization roles are separate. Dangerous Instance changes require a recent re-authentication elevation.

Secret values are never returned by admin APIs. Environment-managed credentials remain read-only; opt-in managed values use authenticated envelope encryption with an external master key. Audit records include Request ID and a body-free summary.

## Before going public

- Read the [Threat model](/docs/self-hosting/security/threat-model/).
- Report vulnerabilities through [Vulnerability reporting](/docs/self-hosting/security/vulnerability-reporting/), not a public Issue.
- Terminate TLS, set `PUBLIC_BASE_URL`, and inject secrets through an external Secret manager.
