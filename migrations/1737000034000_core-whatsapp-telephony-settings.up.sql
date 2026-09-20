-- Seed das chaves globais de WhatsApp (Evolution API) e Telefonia (discagem via
-- curl) na Central de Configurações. Idempotente: preserva valor persistido,
-- atualiza metadados de exibição.
--
-- WhatsApp/Evolution: valores globais servem de FALLBACK para usuários sem
-- credenciais próprias e como padrão que o superadministrador define.
-- Telefonia: o template de curl é executado pelo backend com as variáveis do
-- sistema substituídas ({{ramal}}, {{telefone}}, {{telefone_e164}}, {{usuario}},
-- {{contato}}), permitindo integrar com qualquer PABX remoto que aceite HTTP.

INSERT INTO core.settings (key, module, value, value_type, label, description, default_value) VALUES
  ('core.whatsapp.evolution.base_url', 'core', NULL, 'string',
   'Evolution API — URL base (global)',
   'URL base da Evolution API usada como padrão quando o usuário não define a própria (ex.: https://evo.suaempresa.com).', ''),
  ('core.whatsapp.evolution.api_key', 'core', NULL, 'string',
   'Evolution API — API Key (global)',
   'Chave de API global da Evolution (fallback). Cada usuário pode ter a sua.', ''),
  ('core.whatsapp.evolution.default_instance', 'core', NULL, 'string',
   'Evolution API — Instância padrão',
   'Nome da instância/sessão padrão quando o usuário não informa a sua.', ''),

  ('core.telephony.dial.enabled', 'core', NULL, 'bool',
   'Discagem por PABX habilitada',
   'Ativa o botão "Ligar" no cadastro de contatos (dispara o curl configurado ao PABX).', 'false'),
  ('core.telephony.dial.curl_template', 'core', NULL, 'string',
   'Telefonia — Comando curl de discagem',
   'Comando curl executado para solicitar a chamada ao PABX remoto. Variáveis: {{ramal}}, {{telefone}}, {{telefone_e164}}, {{usuario}}, {{contato}}. Ex.: curl -s -X POST https://pabx.local/originate -d "ramal={{ramal}}&destino={{telefone_e164}}"',
   '')
ON CONFLICT (key) DO UPDATE SET
  module = EXCLUDED.module,
  value_type = EXCLUDED.value_type,
  label = EXCLUDED.label,
  description = EXCLUDED.description,
  default_value = EXCLUDED.default_value;
