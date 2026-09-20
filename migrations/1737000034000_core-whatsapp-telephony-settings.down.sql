DELETE FROM core.settings WHERE key IN (
  'core.whatsapp.evolution.base_url',
  'core.whatsapp.evolution.api_key',
  'core.whatsapp.evolution.default_instance',
  'core.telephony.dial.curl_template',
  'core.telephony.dial.enabled'
);
