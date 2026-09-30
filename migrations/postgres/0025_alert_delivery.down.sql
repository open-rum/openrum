-- Rolling back removes the delivery log and any Feishu channels, because the
-- previous kind constraint cannot hold them. Rules that used them keep working
-- and simply lose that channel.
DROP TABLE IF EXISTS alert_deliveries;
DELETE FROM notification_channels WHERE kind = 'feishu';
ALTER TABLE notification_channels DROP CONSTRAINT notification_channels_kind_check;
ALTER TABLE notification_channels
  ADD CONSTRAINT notification_channels_kind_check CHECK (kind IN ('smtp', 'webhook'));
