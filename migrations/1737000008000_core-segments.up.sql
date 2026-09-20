-- core.segments — segmentos persistidos para reutilização (Req 6).
--
-- Um segmento guarda seus critérios (SegmentCriteria) em JSONB e o autor.
-- A avaliação compila os critérios para SQL que projeta apenas contact_id,
-- sem transferir dados de contato aos módulos (Req 6.2, 6.3).

CREATE TABLE core.segments (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  criteria   JSONB NOT NULL,                                 -- SegmentCriteria (Req 6.4)
  created_by UUID NOT NULL REFERENCES core.users (id),       -- autor (Req 6.4)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_segments_created_by ON core.segments (created_by);

COMMENT ON TABLE core.segments IS
  'Segmentos de contatos persistidos. Critérios em JSONB; avaliação retorna apenas contact_id.';
