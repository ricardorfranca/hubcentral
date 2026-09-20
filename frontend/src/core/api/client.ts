/**
 * @file client.ts
 * @module core/api
 *
 * Cliente HTTP tipado do HUB Central. Injeta o token da sessão, serializa JSON
 * e converte respostas de erro no formato `{ code, message, details }` em uma
 * exceção {@link ApiError}. Em `401`, limpa a sessão local.
 */

import type { ApiErrorBody } from "./types.js";
import { getToken, clearSession } from "../auth/session-store.js";

/** Erro tipado lançado pelo cliente, preservando o corpo `{ code, message, details }`. */
export class ApiError extends Error {
  public readonly code: string;
  public readonly status: number;
  public readonly details: Record<string, unknown>;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.name = "ApiError";
    this.status = status;
    this.code = body.code;
    this.details = body.details ?? {};
  }
}

/** Opções de uma requisição. */
interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  /** Se `false`, não anexa o token (ex.: login). Default `true`. */
  authenticated?: boolean;
}

/**
 * Executa uma requisição à API e retorna o corpo JSON tipado como `T`.
 *
 * @typeParam T - Tipo esperado do corpo de resposta.
 * @param path - Caminho relativo (ex.: `/api/crm/leads`).
 * @param options - Método, corpo e flag de autenticação.
 * @returns O corpo da resposta tipado.
 * @throws {ApiError} Se a resposta não for 2xx.
 */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, authenticated = true } = options;
  const headers: Record<string, string> = {};

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (authenticated) {
    const token = getToken();
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
  }

  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  const response = await fetch(path, init);

  if (response.status === 401) {
    clearSession();
  }

  if (!response.ok) {
    const errorBody = await safeJson(response);
    throw new ApiError(response.status, normalizeError(errorBody));
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

/** Lê JSON com tolerância a corpo vazio/inválido. */
async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/** Garante o formato `{ code, message, details }` mesmo em erros não estruturados. */
function normalizeError(body: unknown): ApiErrorBody {
  if (body && typeof body === "object" && "code" in body && "message" in body) {
    return body as ApiErrorBody;
  }
  return { code: "UNKNOWN", message: "Erro inesperado.", details: {} };
}
