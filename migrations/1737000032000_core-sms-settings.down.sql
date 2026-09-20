DELETE FROM core.settings WHERE key IN (
  'core.sms.provider',
  'core.sms.clickatell.api_key', 'core.sms.clickatell.from',
  'core.sms.goip.base_url', 'core.sms.goip.username', 'core.sms.goip.password', 'core.sms.goip.line'
);
