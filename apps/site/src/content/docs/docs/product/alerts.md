---
title: Alerts
description: Rules that watch a Project's error, API and performance metrics and notify a Feishu group or your own service when a threshold is crossed.
appliesTo: Alpha
---

An alert rule watches one metric of a Project. When the metric crosses its threshold, OpenRUM records the breach and notifies the rule's channels, with a link back to the page that explains it.

## Create a rule

Open **Alerts** in the Project navigation and select **New rule**, or start from a template. A template only fills in the editor; nothing is saved until you select **Create rule**.

| Setting     | Meaning                                                                               |
| ----------- | ------------------------------------------------------------------------------------- |
| Metric      | Error count, error rate, API failure rate, or LCP P75                                 |
| Condition   | Reaches (≥) or exceeds (>) a threshold, in the metric's unit                          |
| Window      | 5, 10, 15, 30 or 60 minutes. The rule is evaluated once per finished window.          |
| Environment | One Environment, or all of them                                                       |
| Cooldown    | After a notification, the same rule stays quiet for this long                         |
| Channels    | Where to send the notification. With none, breaches are only recorded in the Console. |

The editor summarizes the rule in one sentence before you save it, for example: "When production's error rate over the last 5 minutes reaches 2%, notify Feishu · Frontend on-call."

- Error rate is errors per page view and can exceed 100%.
- An API failure is a network failure or a 5xx response. A 4xx is not a failure.
- Members, Admins and Owners manage rules. Viewers can read them.

## Notification history

The **Notification history** tab lists every breach with its value, its threshold and what happened to it:

| State         | Meaning                                                         |
| ------------- | --------------------------------------------------------------- |
| Delivered     | Every channel accepted the notification                         |
| Partly failed | Some channels failed; hover a channel to see why                |
| Failed        | No channel accepted it. OpenRUM retries up to three times.      |
| No channels   | The rule had no channels when it fired                          |
| Cooldown      | The rule already notified recently, so this breach was not sent |

**Open diagnosis** opens the Issues, API or Performance page over the breached window and Environment.

## Channels

Channels belong to the organization, so every Project's rules can use them. Owners and Admins manage them under **Settings → Notification channels**.

| Channel                                  | Status                                       |
| ---------------------------------------- | -------------------------------------------- |
| [Feishu](/docs/product/alerts/feishu/)   | Available: interactive cards in a group chat |
| [Webhook](/docs/product/alerts/webhook/) | Available: signed JSON to your HTTPS service |
| DingTalk, WeCom, Slack, email            | Coming soon; shown but not selectable        |

Every channel can send a test message. Channel addresses and secrets are encrypted with the Instance master key and never returned by the API, so the Instance needs `OPENRUM_ALLOW_MANAGED_SECRETS` and `OPENRUM_MASTER_KEY` on both the API and the worker. Destinations must be public HTTPS addresses; private and internal addresses are refused. See [Threat model](/docs/self-hosting/security/threat-model/).

Related: [Investigation](/docs/product/investigation/), [Troubleshooting](/docs/self-hosting/troubleshooting/).
