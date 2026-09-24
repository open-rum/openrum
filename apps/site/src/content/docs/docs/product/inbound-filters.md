---
title: Inbound filters
description: Stop crawler traffic, extension errors and known noise from entering a project, after measuring what each rule would remove.
appliesTo: Alpha
---

Inbound filters decide which reports never become data. They live under **Project settings → Inbound filters** and apply per project.

Nothing is filtered until you switch something on. A project that has never opened the page keeps every event, and upgrading OpenRUM does not change that.

## Three states, not two

Every category and every rule is `off`, `dry_run`, or `enforced`.

| State | Stored? | Counted? | Use it to |
| --- | --- | --- | --- |
| Off | Yes | No | Ignore the category entirely. |
| Measuring | Yes | Yes | Find out what the rule would remove, before it removes anything. |
| Dropping | No | Yes | Actually keep the events out. |

The middle state is the point of the feature. Going straight to dropping means you discover a rule's blast radius only after the data it would have kept is gone. Leave a new rule measuring for a day, read the counter, then decide.

## Built-in categories

These need no pattern.

### Bot traffic

Flags user agents that identify themselves as crawlers or headless browsers. Two things are worth knowing before you enable it.

Most crawlers never appear in the first place. A crawler that does not run JavaScript never loads the browser SDK, so it produces no events at all — link preview fetchers read your meta tags and leave. What actually reaches OpenRUM is Googlebot, which renders with Chrome, and headless browsers.

**Headless browsers count as bots.** Playwright and Puppeteer runs are flagged, so enabling this also removes your end-to-end tests and any synthetic availability checks. If you use those to watch real-user metrics, this category is not what you want.

### Browser extension errors

Matches errors whose stack points at extension code (`chrome-extension://` and the Firefox and Safari equivalents). These were not thrown by your page, and you cannot fix them.

### Local pages

Matches pages served from `localhost`, a loopback address, a `.local` name, or a link-local address.

Private ranges such as `10.0.0.0/8` and `192.168.0.0/16` are deliberately **not** included. A self-hosted deployment is exactly the case where an intranet application is the real traffic, so treating those addresses as developer noise would discard the data you installed OpenRUM to collect.

## Custom rules

A rule matches one field against a pattern. Up to 50 per project.

| Field | Matched against |
| --- | --- |
| Error title | The type and message joined the way the issue list shows them, e.g. `TypeError: undefined is not a function`. |
| Stack frame URL | Each line of the stack, separately. |
| Page URL | The normalized page address. |
| Release | The release identifier. |

### Patterns are globs, not regular expressions

`*` matches any run of characters and is the only metacharacter. Matching ignores case.

```text
ResizeObserver loop*          matches "ResizeObserver loop limit exceeded"
*vendor/analytics.js*         matches any frame from that file
https://staging.*             matches any page on a staging host
canary-*                      matches releases canary-1, canary-17, …
```

Anchoring is implicit: without a leading `*` the value must start with the pattern, and without a trailing one it must end with it.

Regular expressions are not offered, and the reason is not simplicity. The same pattern has to run in two engines. The server compiles with RE2, which cannot backtrack but also rejects lookahead and backreferences. A browser's `RegExp` accepts both and does backtrack, so a pattern tested in your console could either fail to compile on the server or hang a phone. One wildcard means the same thing in both places.

## Where rules are applied

The consumer is authoritative. It evaluates the full rule set on everything it receives, so the result does not depend on which SDK version your visitors are running.

The browser SDK additionally drops some events before uploading them, which saves bandwidth and nothing else. It receives only the subset it can evaluate against exactly the same input the server uses:

- Only `enforced` entries. A measuring rule must reach the server, or the counter it exists for would read zero.
- Not the bot category, which needs the same user-agent parsing the server does. A second implementation would drift from the first.
- Not page URL rules. The server matches the normalized address, whose path has had identifier-looking segments replaced — `/orders/12345` is matched as `/orders/:id` — and a browser holds the original.

## When a change takes effect

Saving bumps the SDK config version. The consumer picks up new settings within about 30 seconds. Browsers refresh their copy within about 5 minutes, and one that is offline or running an old SDK keeps using its cached set until then. Because the consumer applies the real rules regardless, a stale browser costs uploads, not accuracy.

## Reading the counters

Operators can see matches instance-wide through `openrum_consumer_filtered_total`, labelled by `reason` and by `mode`. Only the `enforced` share removes events, which keeps the reconciliation in the [Kafka runbook](/docs/self-hosting/kafka/) exact: accepted equals stored, plus dead-lettered, plus enforced filter matches.

Per-project figures are not exposed as metric labels, because that would grow the series count with every project. For the bot category the flag is stored on the event, so a project-level share can be queried directly — see [Ingest flags](/docs/reference/ingest-flags/).

## What inbound filters are not

They are not abuse protection. Filtering runs in the consumer, by which point the event has already passed ingest, consumed quota and been written to Kafka — the capacity was already spent, and removing it afterwards only cleans up reports. Rate limiting, origin allow-lists and payload bounds are enforced at the edge instead; see [Threat model](/docs/self-hosting/security/threat-model/).
