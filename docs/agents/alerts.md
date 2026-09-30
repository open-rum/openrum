# Alerts and notification channels

Read this before changing alert rules, evaluation, delivery, notification channels, or
the Alerts and Notification channels pages.

## How a breach becomes a message

1. The worker's alert scheduler (`services/worker/internal/alert_scheduler.go`) runs every
   minute under a Postgres advisory lock, so one worker evaluates at a time.
2. `AlertEvaluator` (`alert_evaluator.go`) reads each enabled rule's metric for the last
   finished fixed window from ClickHouse `project_metrics_1m` and records one
   `alert_evaluations` row per rule and window. A breach inside the cooldown of the last
   successful notification is stored as `suppressed`.
3. `ChannelDispatcher` (`alert_dispatcher.go`) sends a breach to the rule's enabled
   channels (`alert_rule_channels`), decrypting each config with the Instance keyring, and
   writes one `alert_deliveries` row per channel. The window is marked notified when at
   least one channel accepted it, or when the rule has no channels.
4. A breach that no channel accepted is offered again on later ticks, at most three
   attempts per channel, counted from `alert_deliveries`.

The API (`services/api/internal/handlers/{alerts,channels}.go`) serves rule and channel
CRUD, the notification history with per-channel outcomes, and test sends.

## Channel kinds

Kinds are registered in `internal/notify/kinds.go`. Today: `webhook` (signed JSON) and
`feishu` (Feishu/Lark group bot cards). `smtp` has a notifier but is not registered, so it
cannot be created. To add a kind:

1. Implement a `Notifier` in `internal/notify/<kind>.go` and register a `KindSpec` with
   its config normalization, write-only secret fields and builder. Map provider error
   codes onto short `DeliveryError` codes.
2. Add the kind to the `notification_channels.kind` constraint in a new Postgres
   migration, and to `creatableChannelKinds` in `internal/metadata/alerts.go`.
3. Move the kind from `soon` to `available` in the Console's
   `features/settings/channels/channelKinds.ts`, with its fields and validation, and add
   readable text for its error codes in `features/alerts/alertRules.ts`.
4. Add a public docs page under `product/alerts/` in both languages and list it on
   `product/alerts.md`.

## Rules that must hold

- Every outbound request goes through `NewSafeWebhookClient`: public HTTPS only, private
  and metadata addresses refused at save time, before sending, at dial time and on every
  redirect. Kind-specific hosts (Feishu) are allowlisted on top of that.
- Channel configs are sealed with `ChannelAAD(channelID)` and never returned by the API.
  Secret fields are write-only: a blank value on update keeps the stored one.
- Stored and displayed error codes are fixed short strings. Never store a response body,
  URL, token or secret in `alert_deliveries` or logs.
- Channels belong to an organization. A rule may only link its own organization's
  channels. Owners and Admins manage channels (`auth.ActionManageChannels`); Members also
  manage rules (`auth.ActionManageAlerts`).
- Console and backend validation stay in step: `validateRule` in
  `features/alerts/alertRules.ts` mirrors `validAlertRule` in `internal/metadata/alerts.go`.
- The worker needs the same `OPENRUM_ALLOW_MANAGED_SECRETS`, `OPENRUM_MASTER_KEY` and
  `PUBLIC_BASE_URL` as the API. Without the key every delivery is recorded as
  `secrets_unavailable`.

## Not built yet

Firing/resolved state and resolve notifications, silences and acknowledgement, rules on
new or regressed Issues and affected users, and DingTalk, WeCom, Slack and email delivery.
