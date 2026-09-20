DROP TABLE IF EXISTS mod_crm.campaign_recipients;

ALTER TABLE mod_crm.campaigns
  DROP COLUMN IF EXISTS auto_dispatch,
  DROP COLUMN IF EXISTS scheduled_at,
  DROP COLUMN IF EXISTS batch_size,
  DROP COLUMN IF EXISTS per_hour,
  DROP COLUMN IF EXISTS dispatch_status,
  DROP COLUMN IF EXISTS sent_count,
  DROP COLUMN IF EXISTS window_started_at,
  DROP COLUMN IF EXISTS window_sent_count,
  DROP COLUMN IF EXISTS last_dispatched_at;
