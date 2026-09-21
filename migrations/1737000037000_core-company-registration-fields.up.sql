-- Amplia o cadastro de EMPRESA na Base Central de Contatos (Req 1.4, 7.2).
--
-- Decisão de design: empresa é uma linha de core.contacts (contact_type =
-- 'empresa'). Os dados cadastrais oficiais moram AQUI, no núcleo, e nunca em
-- schemas mod_* — o contrato de módulos proíbe copiar dado de contato
-- (Req 7.1/7.2, validado por src/core/contract/schema-lint.ts). Assim CRM,
-- Projetos e campanhas continuam referenciando por contact_id.
--
-- Todas as colunas são NULLABLE (ou têm DEFAULT) para não invalidar as
-- empresas já cadastradas; o CHECK contacts_required_fields_by_type segue
-- exigindo apenas legal_name + fiscal_document.

ALTER TABLE core.contacts
  -- Status do cliente: contrato ativo (1) ou não (0).
  ADD COLUMN contract_active             BOOLEAN NOT NULL DEFAULT false,

  -- Dados oficiais
  ADD COLUMN state_tax_id                TEXT,     -- Inscrição estadual (ou ISENTO)
  ADD COLUMN website                     TEXT,

  -- Endereço (preenchível automaticamente a partir do CEP)
  ADD COLUMN zip_code                    TEXT,     -- CEP, somente dígitos (8)
  ADD COLUMN street_address              TEXT,     -- logradouro
  ADD COLUMN address_number              TEXT,     -- número (não vem do CEP)
  ADD COLUMN address_complement          TEXT,     -- sala/andar/bloco
  ADD COLUMN neighborhood                TEXT,     -- bairro
  ADD COLUMN city                        TEXT,
  ADD COLUMN state                       TEXT,     -- UF (2 letras maiúsculas)

  -- Dois telefones principais, cada um com marcação de WhatsApp
  ADD COLUMN phone_primary               TEXT,     -- E.164 (+55DDNNNNNNNNN)
  ADD COLUMN phone_primary_is_whatsapp   BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN phone_secondary             TEXT,
  ADD COLUMN phone_secondary_is_whatsapp BOOLEAN NOT NULL DEFAULT false,

  -- Gerente de contas: usuário do sistema responsável pela empresa.
  -- ON DELETE SET NULL preserva o cadastro da empresa se o usuário for removido.
  ADD COLUMN account_manager_user_id     UUID REFERENCES core.users (id) ON DELETE SET NULL;

-- Formato de CEP: 8 dígitos. Espelha ZIP_CODE_PATTERN em core/contacts/validation.ts.
ALTER TABLE core.contacts
  ADD CONSTRAINT contacts_zip_code_format CHECK (
    zip_code IS NULL OR zip_code ~ '^[0-9]{8}$'
  );

-- Formato de UF: 2 letras maiúsculas. Espelha STATE_PATTERN em validation.ts.
ALTER TABLE core.contacts
  ADD CONSTRAINT contacts_state_format CHECK (
    state IS NULL OR state ~ '^[A-Z]{2}$'
  );

-- "Empresas do gerente X" (carteira de contas).
CREATE INDEX idx_contacts_account_manager
  ON core.contacts (account_manager_user_id)
  WHERE account_manager_user_id IS NOT NULL;

-- "Clientes com contrato ativo" — filtro padrão da listagem de empresas.
CREATE INDEX idx_contacts_company_contract_active
  ON core.contacts (contract_active)
  WHERE contact_type = 'empresa' AND merged_into IS NULL;

COMMENT ON COLUMN core.contacts.contract_active IS
  'Empresa com contrato ativo (true) ou sem contrato ativo (false). Só é significativo para contact_type = ''empresa''.';
COMMENT ON COLUMN core.contacts.zip_code IS
  'CEP em 8 dígitos, sem máscara. Usado para autofill de logradouro/bairro/cidade/UF.';
COMMENT ON COLUMN core.contacts.phone_primary IS
  'Telefone principal da empresa em E.164. Distinto de core.contacts.phone, que é o telefone da PESSOA.';
COMMENT ON COLUMN core.contacts.account_manager_user_id IS
  'Gerente de contas: usuário do sistema (core.users) responsável pela empresa.';

-- Vocabulário de papéis do vínculo empresa↔pessoa (Req 2.3). O papel segue
-- TEXT livre para não invalidar vínculos existentes; a UI e as rotas HTTP
-- trabalham com o conjunto canônico abaixo.
COMMENT ON COLUMN core.contact_company_links.role IS
  'Papel da pessoa na empresa. Conjunto canônico: principal (responsável principal), tecnico, portabilidade, extra. Texto livre é aceito por compatibilidade.';

-- Uma empresa tem no máximo UM responsável principal.
CREATE UNIQUE INDEX uq_ccl_company_principal
  ON core.contact_company_links (company_id)
  WHERE role = 'principal';
