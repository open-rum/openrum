-- Feishu (Lark) group bots become a native notification channel kind.
ALTER TABLE notification_channels DROP CONSTRAINT notification_channels_kind_check;
ALTER TABLE notification_channels
  ADD CONSTRAINT notification_channels_kind_check CHECK (kind IN ('smtp', 'webhook', 'feishu'));

-- One row per channel per delivery attempt group: a breached window notifying a
-- rule's channels, or a test send from the channel settings. error_code is a short
-- fixed code; response bodies and secrets are never stored.
CREATE TABLE alert_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  evaluation_id UUID REFERENCES alert_evaluations(id) ON DELETE CASCADE,
  rule_id UUID REFERENCES alert_rules(id) ON DELETE CASCADE,
  channel_id UUID NOT NULL REFERENCES notification_channels(id) ON DELETE CASCADE,
  kind VARCHAR(8) NOT NULL CHECK (kind IN ('alert', 'test')),
  status VARCHAR(8) NOT NULL CHECK (status IN ('sent', 'failed')),
  attempts SMALLINT NOT NULL DEFAULT 1 CHECK (attempts BETWEEN 1 AND 10),
  error_code VARCHAR(64) NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((kind = 'alert') = (evaluation_id IS NOT NULL))
);

CREATE INDEX alert_deliveries_evaluation_idx ON alert_deliveries (evaluation_id, channel_id);
CREATE INDEX alert_deliveries_channel_idx ON alert_deliveries (channel_id, created_at DESC);
