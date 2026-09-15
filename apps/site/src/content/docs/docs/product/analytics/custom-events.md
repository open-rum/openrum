---
title: Custom Events
description: How to send a Custom Event, the limits Ingest enforces on its name and payload, and the reserved ui.click schema.
appliesTo: Alpha / main
---

A Custom Event is a product milestone you decided to record. Page Views and clicks arrive on
their own; everything that means something specific to your product arrives through
`captureEvent`.

## Sending one

```ts
import { captureEvent } from "@openrum/browser";

captureEvent("checkout_completed", {
  attributes: { plan: "pro", currency: "USD", coupon: "none" },
  measurements: { amount: 129.0, items: 3 },
});
```

`attributes` are strings you **group by**; `measurements` are numbers you **add up**. Both
are aggregated, but along different axes: an attribute becomes a `property:<key>` dimension
you can split by, while a measurement gets a sum, average, min, max and percentiles. Put the
category in an attribute and the quantity in a measurement.

## The rules the name and payload must satisfy

Both the SDK and Ingest enforce these. The SDK drops the Event locally; Ingest trims what
reaches it and flags the Event `pii_scrubbed`.

| Rule | Limit | On violation |
| --- | --- | --- |
| Event name | 1–80 characters | Dropped by the SDK |
| Reserved prefix | Not `openrum.*` | Dropped by the SDK |
| Attributes | ≤ 20 per Event | Extra keys dropped |
| Attribute key | ≤ 64 characters | Truncated |
| Attribute value | ≤ 512 characters | Truncated |
| Measurements | ≤ 20 per Event | Extra keys dropped |

Scrubbing runs on top of those size limits. Any key whose name contains `password`, `token`,
`secret`, `authorization`, `cookie`, `accessKey` or a handful of similar fragments is removed
entirely, and any value that looks like an email address, a Bearer token, a JWT or a
Luhn-valid card number is replaced with a redaction marker.

Add your own patterns and key names under **Project settings → Scrubbing**; they run on top of
the built-in list and cannot switch it off.

## Naming

Use `snake_case` verbs in the past tense, scoped by object: `checkout_completed`,
`trial_started`, `report_exported`. Keep the name a **fixed** string — never interpolate an ID
or a variant into it. `captureEvent(\`order_${id}_done\`)` gives you one event name per
order; `captureEvent("order_completed", { attributes: { channel: "web" } })` gives you one
metric you can group.

## `ui.click` is a reserved schema

The behavior integration emits `ui.click` automatically and Ingest enforces a strict shape on
it. Only these attributes survive:

- `element` — one of `a`, `button`, `input`, `select`, `textarea`, `summary`, `custom`. **Required**; an Event without a recognised element is rejected.
- `role` — one of `button`, `link`, `menuitem`, `tab`
- `input_type` — one of `button`, `checkbox`, `radio`, `reset`, `submit`, `file`, and only when `element` is `input`
- `name` — a scrubbed label, ≤ 64 characters

No text content, no values, no selectors — which is what lets click tracking be on by default
without collecting what people typed.

Next: [Instrumentation recipes](/docs/product/analytics/instrumentation/) applies all of this
to the analyses teams actually ask for.
