---
title: API monitoring
description: Observe browser-originated network operations in Session and Issue context.
---

**Applies to:** Alpha / main. Status: Alpha implemented.

API Request events capture browser fetch/XHR timing and failure signals without storing bodies, headers or cookies.

## What you can inspect

- Request Route patterns normalized for cardinality control
- Timing and failure markers inside a Session timeline
- Correlation from a failed request into an Issue that blocked the user

## Privacy defaults

The SDK excludes query strings, bodies, headers and OpenRUM's own ingest endpoint. See [Privacy](/docs/self-hosting/security/privacy/).

Related: [Investigation](/docs/product/investigation/), [Browser SDK](/docs/sdk/browser/).
