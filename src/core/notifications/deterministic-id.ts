/**
 * @file deterministic-id.ts
 * @module core/notifications
 *
 * Gera UUIDs determinísticos (RFC 4122 v5, baseado em SHA-1 + namespace) a
 * partir de uma string. É usado para produzir `source_event_id` estáveis para
 * alertas que não nascem de um evento do outbox — por exemplo, alertas de prazo
 * gerados por varredura periódica. Como o mesmo insumo sempre produz o mesmo
 * UUID, o índice único `uq_notifications_event_recipient` deduplica o alerta
 * entre ciclos do worker: o usuário não recebe o mesmo aviso repetidamente.
 */

import { createHash } from "node:crypto";

/**
 * Namespace fixo dos alertas de prazo do HUB Central. Qualquer UUID sob este
 * namespace é derivado determinística e exclusivamente do nome informado.
 */
const DEADLINE_NAMESPACE = "6f9619ff-8b86-d011-b42d-00c04fc964ff";

/** Converte um UUID textual em seus 16 bytes. */
function uuidToBytes(uuid: string): Buffer {
  return Buffer.from(uuid.replace(/-/g, ""), "hex");
}

/**
 * Deriva um UUID v5 (determinístico) a partir de um nome, sob o namespace de
 * alertas de prazo. Mesmo nome ⇒ mesmo UUID, sempre.
 *
 * @param name - String-chave (ex.: `deadline:task:<id>:overdue:2026-09-22`).
 * @returns UUID v5 no formato canônico `xxxxxxxx-xxxx-5xxx-yxxx-xxxxxxxxxxxx`.
 */
export function deterministicUuid(name: string): string {
  const hash = createHash("sha1")
    .update(uuidToBytes(DEADLINE_NAMESPACE))
    .update(Buffer.from(name, "utf8"))
    .digest();

  const bytes = hash.subarray(0, 16);
  // Versão 5 (SHA-1) e variante RFC 4122.
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
