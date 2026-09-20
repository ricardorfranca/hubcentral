DELETE FROM core.settings WHERE key IN (
  'core.smtp.host', 'core.smtp.port', 'core.smtp.secure',
  'core.smtp.user', 'core.smtp.password', 'core.smtp.from'
);
