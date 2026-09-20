-- Seed das chaves de branding (identidade visual) na Central de Configurações.
-- Permite personalizar nome, logotipo e cores do sistema pela UI de admin.
-- Idempotente: preserva valor persistido, atualiza metadados de exibição.

INSERT INTO core.settings (key, module, value, value_type, label, description, default_value) VALUES
  ('core.branding.system_name', 'core', NULL, 'string',
   'Nome do sistema', 'Nome exibido no topo e no título do portal.', 'HUB Central'),
  ('core.branding.logo_url', 'core', NULL, 'string',
   'Logotipo (URL)', 'URL de uma imagem para o logotipo no canto superior esquerdo.', ''),
  ('core.branding.primary_color', 'core', NULL, 'string',
   'Cor primária', 'Cor principal do tema (hex, ex.: #e53935).', '#e53935'),
  ('core.branding.secondary_color', 'core', NULL, 'string',
   'Cor secundária', 'Cor secundária do tema (hex, ex.: #b71c1c).', '#b71c1c')
ON CONFLICT (key) DO UPDATE SET
  module = EXCLUDED.module,
  value_type = EXCLUDED.value_type,
  label = EXCLUDED.label,
  description = EXCLUDED.description,
  default_value = EXCLUDED.default_value;
