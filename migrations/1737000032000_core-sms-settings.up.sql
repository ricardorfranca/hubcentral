-- Seed das chaves de SMS (gateway) na Central de Configurações. Dois provedores
-- suportados: Clickatell (HTTP API) e GoIP (gateway GSM local via HTTP).
-- Idempotente: preserva valor persistido, atualiza metadados de exibição.

INSERT INTO core.settings (key, module, value, value_type, label, description, default_value) VALUES
  ('core.sms.provider', 'core', NULL, 'string',
   'Provedor de SMS', 'Gateway de SMS: clickatell ou goip.', 'clickatell'),
  ('core.sms.clickatell.api_key', 'core', NULL, 'string',
   'Clickatell — API Key', 'Chave de API do Clickatell (canal one-way HTTP).', ''),
  ('core.sms.clickatell.from', 'core', NULL, 'string',
   'Clickatell — Remetente', 'Remetente/originador aprovado no Clickatell (opcional).', ''),
  ('core.sms.goip.base_url', 'core', NULL, 'string',
   'GoIP — URL base', 'URL base do gateway GoIP (ex.: http://192.168.0.10).', ''),
  ('core.sms.goip.username', 'core', NULL, 'string',
   'GoIP — Usuário', 'Usuário de autenticação do GoIP.', ''),
  ('core.sms.goip.password', 'core', NULL, 'string',
   'GoIP — Senha', 'Senha de autenticação do GoIP.', ''),
  ('core.sms.goip.line', 'core', NULL, 'int',
   'GoIP — Linha', 'Número da linha/canal GSM do GoIP a utilizar.', '1')
ON CONFLICT (key) DO UPDATE SET
  module = EXCLUDED.module,
  value_type = EXCLUDED.value_type,
  label = EXCLUDED.label,
  description = EXCLUDED.description,
  default_value = EXCLUDED.default_value;
