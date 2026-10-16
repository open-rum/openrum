---
title: API monitoring
description: Observe browser-originated network operations in Session and Issue context.
appliesTo: Alpha
---

API Request events capture browser fetch/XHR timing and failure signals. Cookies are never stored, and headers and bodies are stored only for the APIs a Project opts in.

## What you can inspect

- Request Route patterns normalized for cardinality control
- Timing and failure markers inside a Session timeline
- Correlation from a failed request into an Issue that blocked the user

## Privacy defaults

The SDK excludes query strings, cookies and OpenRUM's own ingest endpoint, and reads no header or body unless a Project opted that API in. See [Privacy](/docs/self-hosting/security/privacy/).

## Request and response headers and bodies

Headers such as `content-type`, `etag`, `cache-control` or `x-request-id` often explain a slow or failing request. They are **off by default** and enabled per API:

1. Open **Settings → Data management → API headers**, or choose **Manage header capture** in a request's detail. The second route starts a rule from the endpoint you were looking at.
2. Add a rule: the HTTP method (or any), the endpoint as API monitoring shows it, such as `https://api.example.com/orders/:id` where `:id` stands for an identifier (`*` matches a family of endpoints), and the request and response header names to record, and whether to record the request body, the response body, or both.
3. Save. Owners and Admins can change rules. Browsers pick the change up within about 5 minutes and the Consumer within about 30 seconds; only requests made afterwards are recorded.

Recorded headers and bodies appear in the request's **Details** tab under **Additional information**; JSON is indented, and a body that was redacted or cut says so. They are deleted 3 days after the request, and credential headers such as `authorization` and `cookie` can never be recorded.

Bodies are the most sensitive thing the SDK can collect. Only text, JSON and form bodies of at most 64 KB are read; at most 4 KB is kept; fields named like passwords, tokens, emails, phone numbers or card numbers are replaced by `[REDACTED]`; and free text cannot be fully cleaned. See [Opt-in header and body capture](/docs/self-hosting/security/privacy/#opt-in-header-and-body-capture) for what is guaranteed.

Related: [Investigation](/docs/product/investigation/), [Browser SDK](/docs/sdk/browser/).
