---
title: Search syntax
description: The search language the Logs, Issues, Sessions, Events and API pages share, and what each page can search.
appliesTo: Alpha
---

Logs, Issues, Sessions, Events and API share one search box and one search language. The search is plain text, such as `user.id:"customer-123" AND !browser:Chrome`, so you can copy it, paste it and change a value in place. All conditions must match.

You can type the query, or let the box write it. Suggestions follow the caret: while you type a name it suggests fields, and after the colon it offers conditions such as **is not**, **one of** or **contains**, with the field's common values. Choosing a suggestion writes it into the text and puts `AND` between conditions. Field names, operators and values are shown in different colours. Press Enter to run the search (choosing a value runs it straight away, and an edit that has not run yet says 按 Enter 搜索 in the box); the address bar keeps it as `q`, so a copied link opens the same search.

## Conditions

| Type | Meaning | Works on |
| --- | --- | --- |
| `route:/checkout` | is | every field |
| `!route:/checkout` | is not | every field |
| `browser:[Chrome,Safari]` | is one of; `!browser:[...]` is none of | every field |
| `route:*checkout*` | contains | text fields |
| `route:/api/*` | starts with | text fields |
| `route:*.js` | ends with | text fields |
| `has:trace_id` | has a value; `!has:trace_id` has none. `trace_id:*` means the same | text fields and properties |
| `status:>=500` | compares a number with `>`, `>=`, `<` or `<=` | number fields |
| `duration:>2s` | compares a duration; units are `ms`, `s`, `m` and `h` | duration fields |
| `timeout` | a word with no field searches the page's own text, described below | every page except Events |

- Quote a value that has spaces or special characters: `user.id:"customer 123"`. A quoted `*` is a literal star.
- `*` can only start or end a value.
- One search holds at most 12 conditions and 1,024 characters. A list holds at most 20 values.
- `AND` between conditions is optional: `a:1 b:2` and `a:1 AND b:2` mean the same.
- There is no OR and no parentheses. To match either of two values, use a list. `OR` and `NOT` typed as words are refused, with an explanation under the box.
- Properties are written `attributes.<name>`, for example `attributes.plan:pro`.

When the server refuses a search, the box keeps what you typed, underlines the condition that is wrong and says why.

Links from before this search box carried each filter as its own parameter, such as `?release=2.18.0&browser=Safari`. They still work: those parameters are read as conditions and appear in the box as text.

## What each page searches

### Logs

| Fields | Words with no field |
| --- | --- |
| `level`, `logger`, `release`, `route`, `browser`, `device`, `country`, `trace_id`, `session_id`, `user.id`, `anonymous_user_id`, `message`, and properties as `attributes.<name>` or any other name | Look for the text in the message. The match is case-sensitive |

`!level:[debug,trace] has:trace_id` hides debug output and keeps logs that carry a trace. See [Logs](/docs/product/logs/).

### Issues

| Fields | Words with no field |
| --- | --- |
| `title`, `error.type`, `fingerprint`, `release`, `route`, `browser`, `device`, `country`, `user.id`, `anonymous_user_id`, `attributes.<name>` | Look for the text in the Issue title |

Most fields are answered from the Issue rollup. `user.id`, `anonymous_user_id` and properties are kept only on the error events themselves, so those searches read raw events. They are slower and reach back only as far as raw events are kept.

An Issue's status and owner are search conditions too. They take only `field:value` and cannot be negated:

| Condition | Meaning |
| --- | --- |
| `is:unresolved` | Still needs handling, including regressed Issues. The Issue list opens on it; remove it to see every Issue |
| `is:regressed`, `is:resolved`, `is:ignored` | Regressed, resolved, ignored |
| `is:new` | First seen inside the selected range |
| `is:unassigned`, `is:assigned` | Nobody owns it, somebody does |
| `assigned:me`, `assigned:none` | Assigned to you, unassigned |

The order is a separate selector beside the search box: last seen, first seen (newest Issues first), trend (most growth from the range's first half to its second), events and affected users.

### Sessions

A field about events, such as `route`, matches a Session when any of its events does, and `!route:/checkout` keeps the Sessions that never visited it.

| Fields | Words with no field |
| --- | --- |
| Events of the Session: `route` (also the page URL), `release`, `browser`, `os`, `device`, `country`, `user.id`, `anonymous_user_id`, `session_id`, `event` (a custom event's name), `error` (an error message), `attributes.<name>`<br />The Session itself: `events`, `errors`, `page_views`, `api_failures` (numbers) and `duration` | Look in the Session ID, user IDs, route, URL, custom event names and error messages |

`duration:>2m errors:>0` lists long Sessions that hit an error.

### Events

Choose the event with the selector beside the box, and the split on the distribution card. The box narrows the events by `route` (also the page URL), `country`, `device`, `browser`, `release` and their properties; each property the events carry is offered as a field.

To see checkouts on the Pro plan, select the `checkout` event, then choose **属性 plan** and the value `pro` in the box, or type `attributes.plan:pro`. The totals, trend, breakdown and samples all count only those events.

- **One property, country, device or browser that is one value or one of several, split by that same dimension** (such as `country:CN` split by country): answered from the per-minute rollup, as fast as without a search.
- **Anything else**, such as two conditions together, **is not**, **contains**, a `route` or `release`, or a split by another dimension: counted from the events themselves. That costs more, so with an event selected such a search covers up to a week, and up to a day without one. A longer range asks you to narrow it.

The event catalog, the property list and measurements always describe the whole event and ignore the search.

### API

The ranked endpoint list takes `endpoint`, `method`, `route` and `release`, and a word with no field looks for the text in the endpoint. The sort order is a separate selector beside the box. The list is built from the per-minute rollup, which does not keep status codes or durations, so `status` and `duration` are not list conditions.

## Suggestions and recent searches

When a field is open, its common values in the selected range are suggested from the server, with how often each appears, as you type. Suggestions look at the last 7 days of the range at most and are a typing aid, not an exact count.

The box remembers the last 10 searches run on each page. They are stored in this browser only and offered again when the box is empty.

## What it does not do

- No OR, no parentheses and no regular expressions.
- No SQL. A query editor that runs SQL needs a read-only database account, per-Project row isolation and hard resource limits first; they are not in place in this version.
