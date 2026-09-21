/**
 * @file error-mapping.ts
 * @module http
 *
 * Mapeia {@link DomainError} para códigos de status HTTP, seguindo a tabela de
 * Error Handling do design. Erros desconhecidos viram 500.
 */

import { DomainError, ErrorCode } from "../core/errors.js";

/** Corpo de erro padronizado retornado pela API. */
export interface HttpErrorBody {
  code: string;
  message: string;
  details: Record<string, unknown>;
}

/** Mapa de código de domínio -> status HTTP. */
const STATUS_BY_CODE: Record<string, number> = {
  [ErrorCode.AUTH_UNAUTHORIZED]: 401,
  [ErrorCode.RBAC_ACCESS_DENIED]: 403,
  [ErrorCode.CONTACT_NOT_FOUND]: 404,
  [ErrorCode.CUSTOM_FIELD_NOT_FOUND]: 404,
  [ErrorCode.REFERENCE_CONTACT_NOT_FOUND]: 404,
  [ErrorCode.SETTING_NOT_FOUND]: 404,
  [ErrorCode.NOTIFICATION_NOT_FOUND]: 404,
  [ErrorCode.PROJ_ACCESS_DENIED]: 403,
  [ErrorCode.PROJ_NOT_FOUND]: 404,
  [ErrorCode.PROJ_TASK_NOT_FOUND]: 404,
  [ErrorCode.PROJ_ATTACHMENT_NOT_FOUND]: 404,
  [ErrorCode.PROJ_ARCHIVED]: 409,
  [ErrorCode.PROJ_DEPENDENCY_NOT_DONE]: 409,
  [ErrorCode.PROJ_NOT_ARCHIVED]: 409,
  [ErrorCode.SMTP_NOT_CONFIGURED]: 400,
  [ErrorCode.SMS_NOT_CONFIGURED]: 400,
  [ErrorCode.WHATSAPP_NOT_CONFIGURED]: 400,
  [ErrorCode.TELEPHONY_NOT_CONFIGURED]: 400,
  [ErrorCode.SMTP_ERROR]: 502,
  [ErrorCode.SMS_ERROR]: 502,
  [ErrorCode.WHATSAPP_ERROR]: 502,
  [ErrorCode.TELEPHONY_ERROR]: 502,
  [ErrorCode.CONTACT_DUPLICATE_EMAIL]: 409,
  [ErrorCode.CONTACT_DUPLICATE_DOCUMENT]: 409,
  [ErrorCode.CATEGORY_DUPLICATE_NAME]: 409,
  [ErrorCode.CUSTOM_FIELD_DUPLICATE_NAME]: 409,
  [ErrorCode.LINK_DUPLICATE]: 409,
  [ErrorCode.LINK_PRINCIPAL_EXISTS]: 409,
  [ErrorCode.CONTACT_MANAGER_NOT_FOUND]: 404,
  [ErrorCode.MODULE_ALREADY_REGISTERED]: 409,
  [ErrorCode.CONTACT_HAS_REFERENCES]: 409,
  // Demais erros de validação -> 400 (default abaixo).
};

/**
 * Resolve o status HTTP para um erro. {@link DomainError} usa o mapa (default
 * 400 para erros de validação de domínio); qualquer outro erro é 500.
 *
 * @param error - Erro capturado.
 * @returns Status HTTP e corpo padronizado.
 */
export function mapError(error: unknown): { status: number; body: HttpErrorBody } {
  if (error instanceof DomainError) {
    const status = STATUS_BY_CODE[error.code] ?? 400;
    return { status, body: error.toJSON() };
  }
  return {
    status: 500,
    body: { code: "INTERNAL_ERROR", message: "Erro interno.", details: {} },
  };
}
