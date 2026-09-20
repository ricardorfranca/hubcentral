DELETE FROM core.settings WHERE key IN (
  'core.branding.system_name',
  'core.branding.logo_url',
  'core.branding.primary_color',
  'core.branding.secondary_color'
);
