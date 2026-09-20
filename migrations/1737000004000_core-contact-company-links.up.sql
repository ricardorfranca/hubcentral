-- core.contact_company_links — vínculo M:N entre empresas e pessoas (Req 2).
--
-- Uma empresa pode ter várias pessoas vinculadas (uma empresa → muitas pessoas).
-- O papel (role) da pessoa na empresa é opcional (Req 2.3, 2.4).
--
-- A FK garante que ambos os lados existem em core.contacts, mas NÃO distingue
-- o subtipo (pessoa/empresa) — essa validação é feita na camada de serviço
-- (Req 2.4). ON DELETE CASCADE: se um contato é removido, seus vínculos somem
-- junto (a proteção contra exclusão de contato referenciado por MÓDULOS é
-- tratada separadamente em core.contact_references, Tarefa 6).

CREATE TABLE core.contact_company_links (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES core.contacts (id) ON DELETE CASCADE,
  person_id  UUID NOT NULL REFERENCES core.contacts (id) ON DELETE CASCADE,
  role       TEXT,  -- papel opcional; 1..100 chars validado no serviço (Req 2.3)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Unicidade do par: impede vínculo duplicado (Req 2.5, 2.7)
  CONSTRAINT uq_contact_company_link UNIQUE (company_id, person_id),
  -- Um contato não pode se vincular a si mesmo
  CONSTRAINT contact_company_link_distinct CHECK (company_id <> person_id)
);

-- Consulta "empresas de uma pessoa" (Req 2.6) e navegação inversa.
CREATE INDEX idx_ccl_person ON core.contact_company_links (person_id);
CREATE INDEX idx_ccl_company ON core.contact_company_links (company_id);

COMMENT ON TABLE core.contact_company_links IS
  'Vínculo M:N empresa↔pessoa. A validação de subtipo (company=empresa, person=pessoa) é feita no serviço (Req 2.4).';
