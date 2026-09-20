/**
 * @file attachment-service.ts
 * @module modules/projetos
 *
 * Anexos de tarefa armazenados em disco local. O arquivo é salvo com um nome
 * seguro (UUID + extensão normalizada) sob `UPLOADS_DIR/projetos/<project>/<task>/`;
 * os metadados ficam em `mod_projetos.task_attachments`. Os limites (tamanho e
 * tipos permitidos) vêm da Central de Configurações (`core.settings`), com as
 * variáveis de ambiente como fallback inicial.
 */

import type { PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { DomainError, ErrorCode } from "../../core/errors.js";
import { log as auditLog } from "../../core/audit/audit-logger.js";
import { getSettingInt, getSettingList } from "../../core/settings/settings-service.js";

/** Anexo como persistido em `mod_projetos.task_attachments`. */
export interface Attachment {
  id: string;
  task_id: string;
  original_name: string;
  stored_name: string;
  mime_type: string | null;
  size_bytes: number;
  uploaded_by: string | null;
  created_at: Date;
}

/** Diretório base de uploads (env como fallback do default de plataforma). */
export function uploadsDir(): string {
  return process.env.UPLOADS_DIR ?? "/opt/hubcentral/uploads";
}

/** Extensão normalizada (sem ponto, minúscula, só alfanumérica) de um nome. */
function safeExtension(originalName: string): string {
  const ext = path.extname(originalName).replace(/^\./, "").toLowerCase();
  return /^[a-z0-9]+$/.test(ext) ? ext : "";
}

/**
 * Valida os limites de anexo (tamanho e tipo) contra a Central de Configurações.
 *
 * @param client - Cliente PostgreSQL.
 * @param originalName - Nome original do arquivo.
 * @param sizeBytes - Tamanho em bytes.
 * @throws {DomainError} `PROJ_ATTACHMENT_INVALID` se exceder tamanho ou tipo não permitido.
 */
export async function validateAttachment(
  client: PoolClient,
  originalName: string,
  sizeBytes: number,
): Promise<void> {
  const maxBytes = await getSettingInt(client, "projetos.uploads.max_bytes", 26_214_400, "UPLOADS_MAX_BYTES");
  const allowed = await getSettingList(
    client,
    "projetos.uploads.allowed",
    ["pdf", "png", "jpg", "jpeg", "gif", "webp", "txt", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "zip"],
    "UPLOADS_ALLOWED",
  );
  if (sizeBytes > maxBytes) {
    throw new DomainError(ErrorCode.PROJ_ATTACHMENT_INVALID, "Arquivo excede o tamanho máximo permitido.", {
      size_bytes: sizeBytes,
      max_bytes: maxBytes,
    });
  }
  const ext = safeExtension(originalName);
  if (!ext || !allowed.includes(ext)) {
    throw new DomainError(ErrorCode.PROJ_ATTACHMENT_INVALID, "Tipo de arquivo não permitido.", {
      extension: ext,
      allowed,
    });
  }
}

/**
 * Persiste um anexo já validado: grava o conteúdo em disco (escrita atômica via
 * arquivo temporário + rename) e registra os metadados. Audita.
 *
 * @param client - Cliente PostgreSQL.
 * @param input - Tarefa, projeto, nome original, mime, conteúdo (Buffer).
 * @param actorUserId - Autor do upload.
 * @returns O anexo persistido.
 */
export async function saveAttachment(
  client: PoolClient,
  input: { taskId: string; projectId: string; originalName: string; mimeType?: string | undefined; content: Buffer },
  actorUserId: string | null = null,
): Promise<Attachment> {
  await validateAttachment(client, input.originalName, input.content.byteLength);

  const ext = safeExtension(input.originalName);
  const storedName = ext ? `${randomUUID()}.${ext}` : randomUUID();
  const dir = path.join(uploadsDir(), "projetos", input.projectId, input.taskId);
  await fs.mkdir(dir, { recursive: true });

  const finalPath = path.join(dir, storedName);
  const tmpPath = `${finalPath}.tmp`;
  await fs.writeFile(tmpPath, input.content);
  await fs.rename(tmpPath, finalPath);

  const { rows } = await client.query<Attachment>(
    `INSERT INTO mod_projetos.task_attachments
       (task_id, original_name, stored_name, mime_type, size_bytes, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, task_id, original_name, stored_name, mime_type, size_bytes, uploaded_by, created_at`,
    [input.taskId, input.originalName, storedName, input.mimeType ?? null, input.content.byteLength, actorUserId],
  );
  const attachment = rows[0] as Attachment;
  await auditLog(client, {
    userId: actorUserId,
    module: "projetos",
    action: "PROJ_ANEXO_ENVIADO",
    payloadAfter: { attachment_id: attachment.id, task_id: input.taskId, size_bytes: attachment.size_bytes },
  });
  return attachment;
}

/**
 * Lista os anexos de uma tarefa (metadados).
 *
 * @param client - Cliente PostgreSQL.
 * @param taskId - `id` da tarefa.
 * @returns Os anexos da tarefa.
 */
export async function listAttachments(client: PoolClient, taskId: string): Promise<Attachment[]> {
  const { rows } = await client.query<Attachment>(
    `SELECT id, task_id, original_name, stored_name, mime_type, size_bytes, uploaded_by, created_at
     FROM mod_projetos.task_attachments WHERE task_id = $1 ORDER BY created_at`,
    [taskId],
  );
  return rows;
}

/** Anexo com o `project_id` resolvido (para verificação de acesso e caminho). */
export interface AttachmentWithProject extends Attachment {
  project_id: string;
}

/**
 * Retorna um anexo com o `project_id` da tarefa (para download/exclusão).
 *
 * @param client - Cliente PostgreSQL.
 * @param attachmentId - `id` do anexo.
 * @returns O anexo com `project_id`, ou `null` se não existe.
 */
export async function getAttachment(
  client: PoolClient,
  attachmentId: string,
): Promise<AttachmentWithProject | null> {
  const { rows } = await client.query<AttachmentWithProject>(
    `SELECT a.id, a.task_id, a.original_name, a.stored_name, a.mime_type, a.size_bytes,
            a.uploaded_by, a.created_at, t.project_id
     FROM mod_projetos.task_attachments a
     JOIN mod_projetos.tasks t ON t.id = a.task_id
     WHERE a.id = $1`,
    [attachmentId],
  );
  return rows[0] ?? null;
}

/**
 * Resolve o caminho absoluto em disco de um anexo.
 *
 * @param att - Anexo com `project_id`.
 * @returns Caminho absoluto do arquivo armazenado.
 */
export function attachmentPath(att: AttachmentWithProject): string {
  return path.join(uploadsDir(), "projetos", att.project_id, att.task_id, att.stored_name);
}

/**
 * Exclui um anexo: remove o arquivo do disco (se existir) e os metadados. Audita.
 *
 * @param client - Cliente PostgreSQL.
 * @param attachmentId - `id` do anexo.
 * @param actorUserId - Autor.
 * @returns `true` se o anexo existia e foi removido.
 */
export async function deleteAttachment(
  client: PoolClient,
  attachmentId: string,
  actorUserId: string | null = null,
): Promise<boolean> {
  const att = await getAttachment(client, attachmentId);
  if (!att) return false;

  await client.query(`DELETE FROM mod_projetos.task_attachments WHERE id = $1`, [attachmentId]);
  // Best-effort: remove o arquivo; ignora se já não existe.
  try {
    await fs.unlink(attachmentPath(att));
  } catch {
    // Arquivo ausente não impede a remoção lógica.
  }
  await auditLog(client, {
    userId: actorUserId,
    module: "projetos",
    action: "PROJ_ANEXO_EXCLUIDO",
    payloadAfter: { attachment_id: attachmentId, task_id: att.task_id },
  });
  return true;
}
