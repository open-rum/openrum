---
title: Send alerts to Feishu
description: Connect a Feishu (or Lark) group bot so alerts arrive as cards with a link back to the Console.
---

**Applies to:** Alpha. Status: Alpha implemented.

Alerts arrive in the group as a card with the Project, Environment, metric, value, threshold and window, plus an **Open diagnosis** button.

## 1. Add a custom bot to the group

1. In the Feishu group, open **Settings → Group bots → Add bot → Custom bot**.
2. Name the bot, for example "OpenRUM", and copy its **Webhook address**. It looks like `https://open.feishu.cn/open-apis/bot/v2/hook/…`. Lark addresses on `open.larksuite.com` work too.
3. Under security settings, turn on **Signature verification** and copy the key. This is optional but recommended.
4. If you prefer **Custom keywords** instead, use `OpenRUM`. Every card title contains it.

Treat the webhook address as a secret: anyone who has it can post to the group.

## 2. Add the channel in OpenRUM

1. Open **Settings → Notification channels** and select **Feishu**. You need to be an organization Owner or Admin.
2. Enter a name the team will recognize, the webhook address and the signing key.
3. Keep **Send a test message after saving** on, then save. A blue test card should arrive in the group.

When you edit the channel later, leave the address or key blank to keep the stored value.

## 3. Use it in a rule

Open a Project's **Alerts** page, create or edit a rule, and select the channel under **Channels**. When the rule fires, a red alert card is posted to the group.

## When a message does not arrive

The channel list and the notification history show why a delivery failed:

| Reason                        | Fix                                                                                                                      |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Signature verification failed | The signing key in OpenRUM does not match the bot's key. Copy it again.                                                  |
| Keyword not found             | Set the bot's custom keyword to `OpenRUM`.                                                                               |
| IP not allowed                | The bot has an IP allowlist. Add the egress IP of your OpenRUM servers.                                                  |
| Frequency limited             | Feishu accepts up to 100 messages per minute per bot. OpenRUM retries later; reduce noisy rules or raise their cooldown. |
| Unsafe address                | Only Feishu and Lark bot addresses are accepted for this channel.                                                        |
| Master key missing            | The worker needs `OPENRUM_MASTER_KEY` to decrypt the channel.                                                            |
