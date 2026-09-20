-- Seed das chaves de e-mail (SMTP) na Central de Configurações. Base para
-- todos os envios de e-mail do sistema. Portas padrão pré-definidas.
-- Idempotente: preserva valor persistido, atualiza metadados de exibição.

INSERT INTO core.settings (key, module, value, value_type, label, description, default_value) VALUES
  ('core.smtp.host', 'core', NULL, 'string',
   'Servidor SMTP (host)', 'Endereço do servidor de e-mail de saída.', ''),
  ('core.smtp.port', 'core', NULL, 'int',
   'Porta SMTP', 'Porta do servidor (587 para STARTTLS, 465 para SSL/TLS).', '587'),
  ('core.smtp.secure', 'core', NULL, 'bool',
   'Conexão segura (SSL/TLS)', 'Ative para porta 465 (SSL). Para 587 (STARTTLS), deixe desativado.', 'false'),
  ('core.smtp.user', 'core', NULL, 'string',
   'Usuário SMTP', 'Usuário de autenticação no servidor de e-mail.', ''),
  ('core.smtp.password', 'core', NULL, 'string',
   'Senha SMTP', 'Senha de autenticação no servidor de e-mail.', ''),
  ('core.smtp.from', 'core', NULL, 'string',
   'Remetente (From)', 'Endereço exibido como remetente dos e-mails do sistema.', '')
ON CONFLICT (key) DO UPDATE SET
  module = EXCLUDED.module,
  value_type = EXCLUDED.value_type,
  label = EXCLUDED.label,
  description = EXCLUDED.description,
  default_value = EXCLUDED.default_value;
