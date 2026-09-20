/**
 * @file errors.ts
 * @module core
 *
 * Erros de domínio do núcleo do HUB Central. Todos seguem o formato
 * `{ code, message, details }` exigido pelo design (seção Error Handling),
 * com `message` descritiva conforme os requisitos.
 */

/**
 * Detalhes adicionais e estruturados de um erro de domínio (ex.: o campo
 * ausente, o `contact_id` existente numa duplicidade). As chaves variam por
 * `code`; consulte a tabela de Error Handling do design.
 */
export type DomainErrorDetails = Record<string, unknown>;

/**
 * Erro de domínio do núcleo. Carrega um `code` estável (para o cliente decidir
 * o tratamento), uma `message` legível e `details` estruturados opcionais.
 */
export class DomainError extends Error {
  /** Código estável do erro (ex.: `CONTACT_DUPLICATE_EMAIL`). */
  public readonly code: string;
  /** Detalhes estruturados específicos do código. */
  public readonly details: DomainErrorDetails;

  /**
   * @param code - Código estável do erro.
   * @param message - Mensagem descritiva legível.
   * @param details - Detalhes estruturados opcionais.
   */
  constructor(code: string, message: string, details: DomainErrorDetails = {}) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    this.details = details;
  }

  /**
   * Serializa o erro no formato de resposta `{ code, message, details }`.
   *
   * @returns Objeto simples pronto para retorno em API.
   */
  toJSON(): { code: string; message: string; details: DomainErrorDetails } {
    return { code: this.code, message: this.message, details: this.details };
  }
}

/**
 * Códigos de erro de domínio usados pelo núcleo. Espelham a tabela de Error
 * Handling do design e são referenciados pelos requisitos indicados.
 */
export const ErrorCode = {
  /** Campo obrigatório de contato ausente (Req 1.6). */
  CONTACT_MISSING_FIELD: "CONTACT_MISSING_FIELD",
  /** E-mail de contato em formato inválido (Req 1.5). */
  CONTACT_INVALID_EMAIL: "CONTACT_INVALID_EMAIL",
  /** Pessoa duplicada por e-mail (Req 5.1, 5.2). */
  CONTACT_DUPLICATE_EMAIL: "CONTACT_DUPLICATE_EMAIL",
  /** Empresa duplicada por documento fiscal (Req 5.3, 5.4). */
  CONTACT_DUPLICATE_DOCUMENT: "CONTACT_DUPLICATE_DOCUMENT",
  /** Lado empresa do vínculo não é um Contato_Empresa (Req 2.4). */
  LINK_INVALID_COMPANY: "LINK_INVALID_COMPANY",
  /** Lado pessoa do vínculo não é um Contato_Pessoa (Req 2.4). */
  LINK_INVALID_PERSON: "LINK_INVALID_PERSON",
  /** Vínculo empresa↔pessoa duplicado (Req 2.5). */
  LINK_DUPLICATE: "LINK_DUPLICATE",
  /** Papel do vínculo fora do tamanho permitido 1..100 (Req 2.3). */
  LINK_INVALID_ROLE: "LINK_INVALID_ROLE",
  /** Categoria customizada com nome já existente (Req 3.5). */
  CATEGORY_DUPLICATE_NAME: "CATEGORY_DUPLICATE_NAME",
  /** Nome de categoria vazio/em branco. */
  CATEGORY_INVALID_NAME: "CATEGORY_INVALID_NAME",
  /** Valor de campo personalizado incompatível com o data_type (Req 4.4). */
  CUSTOM_FIELD_TYPE_MISMATCH: "CUSTOM_FIELD_TYPE_MISMATCH",
  /** Campo personalizado com nome já existente (Req 4.1). */
  CUSTOM_FIELD_DUPLICATE_NAME: "CUSTOM_FIELD_DUPLICATE_NAME",
  /** Nome de campo personalizado vazio/em branco. */
  CUSTOM_FIELD_INVALID_NAME: "CUSTOM_FIELD_INVALID_NAME",
  /** Campo personalizado referenciado não existe. */
  CUSTOM_FIELD_NOT_FOUND: "CUSTOM_FIELD_NOT_FOUND",
  /** Referência a um contato inexistente (Req 7.4). */
  REFERENCE_CONTACT_NOT_FOUND: "REFERENCE_CONTACT_NOT_FOUND",
  /** Exclusão de contato bloqueada por referências ativas (Req 7.5). */
  CONTACT_HAS_REFERENCES: "CONTACT_HAS_REFERENCES",
  /** Contato referenciado na operação não existe. */
  CONTACT_NOT_FOUND: "CONTACT_NOT_FOUND",
  /** Mesclagem inválida (tipos diferentes, mesmo contato, ou já mesclado) (Req 5.5). */
  CONTACT_MERGE_INVALID: "CONTACT_MERGE_INVALID",
  /** Segmento sem nenhum critério (Req 6.5). */
  SEGMENT_EMPTY_CRITERIA: "SEGMENT_EMPTY_CRITERIA",
  /** Manifesto de módulo com campo obrigatório ausente (Req 8.2). */
  MANIFEST_MISSING_FIELD: "MANIFEST_MISSING_FIELD",
  /** module_id já registrado (Req 8.3). */
  MODULE_ALREADY_REGISTERED: "MODULE_ALREADY_REGISTERED",
  /** Schema do módulo fora do padrão mod_[nome] (Req 8.4). */
  MANIFEST_INVALID_SCHEMA: "MANIFEST_INVALID_SCHEMA",
  /** Tabela de núcleo declarada em requires_core_tables ausente (Req 8.6). */
  MANIFEST_MISSING_CORE_TABLE: "MANIFEST_MISSING_CORE_TABLE",
  /** Versão do manifesto não está em SemVer (Req 8.8). */
  MANIFEST_INVALID_VERSION: "MANIFEST_INVALID_VERSION",
  /** Namespace RBAC declarado em formato inválido (Req 10.2). */
  RBAC_INVALID_NAMESPACE: "RBAC_INVALID_NAMESPACE",
  /** Requisição sem autenticação válida do IAM (Req 9.4). */
  AUTH_UNAUTHORIZED: "AUTH_UNAUTHORIZED",
  /** Ação negada por falta do namespace RBAC exigido (Req 10.4, 11.5). */
  RBAC_ACCESS_DENIED: "RBAC_ACCESS_DENIED",
  /** Credenciais inválidas no login. */
  IAM_INVALID_CREDENTIALS: "IAM_INVALID_CREDENTIALS",
  /** E-mail já cadastrado ao provisionar usuário. */
  IAM_EMAIL_TAKEN: "IAM_EMAIL_TAKEN",
  /** Senha nova fora da política mínima. */
  IAM_WEAK_PASSWORD: "IAM_WEAK_PASSWORD",
  /** Reenvio de convite antes do cooldown de 60 minutos (§5.6). */
  IAM_RESEND_COOLDOWN: "IAM_RESEND_COOLDOWN",
  /** Usuário não encontrado. */
  IAM_USER_NOT_FOUND: "IAM_USER_NOT_FOUND",
  /** Sessão inválida, expirada ou revogada. */
  IAM_INVALID_SESSION: "IAM_INVALID_SESSION",
  /** Conta desabilitada. */
  IAM_USER_DISABLED: "IAM_USER_DISABLED",
  /** CNPJ inválido ao criar conta (Req CRM 2.0 1.2). */
  CRM_INVALID_CNPJ: "CRM_INVALID_CNPJ",
  /** Oportunidade sem conta associada. */
  CRM_OPP_NO_ACCOUNT: "CRM_OPP_NO_ACCOUNT",
  /** Finalização de oportunidade sem valores (ganho) ou sem motivo (perdido). */
  CRM_OPP_FINALIZE_INVALID: "CRM_OPP_FINALIZE_INVALID",
  /** Estágio inexistente. */
  CRM_STAGE_NOT_FOUND: "CRM_STAGE_NOT_FOUND",
  /** Oportunidade não encontrada. */
  CRM_OPP_NOT_FOUND: "CRM_OPP_NOT_FOUND",
  /** Conta não encontrada. */
  CRM_ACCOUNT_NOT_FOUND: "CRM_ACCOUNT_NOT_FOUND",
} as const;

/** União dos valores de {@link ErrorCode}. */
export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];
