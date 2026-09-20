/**
 * @file comms.ts
 * @module core/api
 *
 * Cliente tipado de comunicação: canal de WhatsApp por usuário (Evolution API),
 * envio de WhatsApp/SMS e discagem telefônica (curl ao PABX) a partir do
 * cadastro de contatos.
 */

import { request } from "./client.js";

/** Canal de WhatsApp do usuário (sem expor a API key; apenas se está definida). */
export interface UserChannel {
  wa_evolution_url: string | null;
  wa_instance: string | null;
  wa_api_key_set: boolean;
  wa_enabled: boolean;
}

/** Campos aceitos ao salvar o canal (api_key opcional: só envia se alterada). */
export interface UserChannelInput {
  wa_evolution_url?: string | null;
  wa_instance?: string | null;
  wa_api_key?: string | null;
  wa_enabled?: boolean;
}

/** Lê o canal do próprio usuário autenticado. */
export function getMyChannel(): Promise<UserChannel> {
  return request<UserChannel>("/api/me/channel");
}

/** Salva o canal do próprio usuário. */
export function saveMyChannel(input: UserChannelInput): Promise<UserChannel> {
  return request<UserChannel>("/api/me/channel", { method: "PUT", body: input });
}

/** Testa o canal do próprio usuário (estado da instância na Evolution). */
export function testMyChannel(): Promise<{ ok: boolean; instance: string }> {
  return request<{ ok: boolean; instance: string }>("/api/me/channel/test", { method: "POST" });
}

/** (Superadmin) Lê o canal de um usuário específico. */
export function getUserChannel(userId: string): Promise<UserChannel> {
  return request<UserChannel>(`/api/iam/users/${userId}/channel`);
}

/** (Superadmin) Salva o canal de um usuário específico. */
export function saveUserChannel(userId: string, input: UserChannelInput): Promise<UserChannel> {
  return request<UserChannel>(`/api/iam/users/${userId}/channel`, { method: "PUT", body: input });
}

/** Envia uma mensagem de WhatsApp pelo canal do usuário autenticado. */
export function sendWhatsapp(to: string, text: string): Promise<void> {
  return request<void>("/api/comms/whatsapp", { method: "POST", body: { to, text } });
}

/** Envia um SMS para o telefone informado (gateway global). */
export function sendSms(to: string, text: string): Promise<void> {
  return request<void>("/api/comms/sms", { method: "POST", body: { to, text } });
}

/** Solicita ao PABX que retorne uma chamada para o ramal do usuário. */
export function requestCall(to: string, contactName?: string): Promise<void> {
  return request<void>("/api/comms/call", { method: "POST", body: { to, contact_name: contactName } });
}
