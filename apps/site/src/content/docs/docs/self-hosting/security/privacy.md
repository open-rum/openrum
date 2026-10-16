---
title: Security and privacy defaults
description: Collection boundaries, RBAC, CSRF and Secret handling.
appliesTo: Alpha
---

## Collection boundaries

The Browser SDK excludes query strings, bodies, headers, cookies and raw input values by default. Sensitive-looking values are scrubbed client-side and the ingest service validates bounded schemas again. HTTP headers and bodies are the one thing a project can switch on, per API; see [Opt-in header and body capture](#opt-in-header-and-body-capture).

## Opt-in header and body capture

Headers and bodies are off until an Owner or Admin names an API and what to record, under **Settings → Data management → API headers**. Request and response bodies are chosen separately from the headers, and each direction on its own.

- **Credentials cannot be captured.** A name containing `auth`, `cookie`, `token`, `secret`, `password`, `session`, `csrf`, `signature` or `api-key`, or a client-address header such as `x-forwarded-for`, is refused when the rule is saved, ignored by the SDK, and removed again by normalization. This cannot be configured.
- **The Consumer decides, not the browser.** A write key is public, so anyone can post an event that carries headers. The Consumer keeps a header only when a Project rule names that header for that method and endpoint, and drops everything else. With no rules, nothing is stored.
- **Values are scrubbed and bounded.** Emails, Bearer tokens, JWTs and card numbers are redacted, the Project's own scrubbing patterns apply, and a value is at most 256 characters with at most 20 headers per direction.
- **Bodies are redacted by structure and cut short.** Only text, JSON and form bodies are read, never files, `FormData` or streams, and a body larger than 64 KB is not captured at all, because JSON must be complete to be redacted by key. In JSON and form bodies, a field whose name contains `password`, `token`, `secret`, `authorization`, `cookie`, `session`, `csrf`, `signature`, `api-key`, `email`, `phone`, `card number`, `cvv` or `ssn` has its value replaced by `[REDACTED]`; emails, Bearer tokens, JWTs and card numbers are redacted anywhere, and the Project's own scrubbing patterns apply. What is kept is at most 4 KB and says so when it was cut. The browser redacts first and the Consumer redacts again.
- **Free text cannot be fully cleaned.** A body can carry personal data that no pattern recognizes, such as a name or an address in a plain field. Enable body capture only for APIs where you need it, and prefer the response side of an endpoint you control.
- **Headers and bodies expire after 3 days**, sooner than the event itself, and every member of the Project can read them while they exist. List only headers that help an investigation and carry no personal data.

Do not send email, phone, payment data, authentication tokens or free-form user text in Custom Events. Prefer opaque account identifiers with `setUser`.

## Authentication and authorization

Authentication uses server-side sessions, HttpOnly cookies, same-origin CSRF validation and service-side RBAC. Instance roles and Organization roles are separate. Dangerous Instance changes require a recent re-authentication elevation.

Secret values are never returned by admin APIs. Environment-managed credentials remain read-only; opt-in managed values use authenticated envelope encryption with an external master key. Audit records include Request ID and a body-free summary.

## Before going public

- Read the [Threat model](/docs/self-hosting/security/threat-model/).
- Report vulnerabilities through [Vulnerability reporting](/docs/self-hosting/security/vulnerability-reporting/), not a public Issue.
- Terminate TLS, set `PUBLIC_BASE_URL`, and inject secrets through an external Secret manager.
