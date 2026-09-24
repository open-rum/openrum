---
title: Ingest flags
description: The markers OpenRUM attaches to an event during normalization, and what each one means for your data.
appliesTo: Alpha
---

Every stored event carries an `ingest_flags` array. A flag records something the pipeline observed about the event that is not part of what the SDK sent. Flags never change the event's own fields, so a flagged event is still complete.

| Flag | Set when | Effect on aggregates |
| --- | --- | --- |
| `synthetic` | The event came from seeded demo or development data rather than a real browser. | Excluded. Every aggregate view filters these out. |
| `clock_adjusted` | The reported timestamp was before the year 2000 or more than 24 hours after ingest received it, so the ingest time was used instead. | None. |
| `pii_scrubbed` | Redaction changed at least one field — a user identifier, a title, an attribute, an error message or a breadcrumb. | None. |
| `bot` | The user agent identified a crawler or a headless browser. | None by default. A project can choose to drop these; see [Inbound filters](/docs/product/inbound-filters/). |

## Reading flags

Flags are stored as a `LowCardinality` array, so filtering on them is cheap:

```sql
SELECT countIf(has(ingest_flags, 'bot')) AS bot_events, count() AS all_events
FROM rum_events
WHERE project_id = {project:UUID} AND event_time >= now() - INTERVAL 7 DAY;
```

## The bot flag

`bot` marks traffic the user agent says is automated. It is recorded during normalization, which is the last stage that still holds the raw user agent — the stored event keeps only the parsed browser and OS, so the distinction cannot be recovered later.

Two things are worth knowing before you act on it.

**Most crawlers never appear at all.** A crawler that does not run JavaScript never loads the browser SDK, so it produces no events. Link preview fetchers are the clearest case: they read the page's meta tags and leave. What actually reaches OpenRUM is Googlebot, which renders with Chrome, and headless browsers.

**Headless browsers are counted as bots.** End-to-end test runs and synthetic availability checks driven by Playwright or Puppeteer are flagged. Whether that is noise or the signal you care about depends on what you use them for.

The flag is always recorded, whatever a project decides to do with it. Acting on it is opt-in and configured per project under [Inbound filters](/docs/product/inbound-filters/), where the category can measure first and drop later. Operators can watch the same categories instance-wide through `openrum_consumer_filtered_total`, labelled by `reason` and by `mode`.
