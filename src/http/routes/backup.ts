/**
 * @file backup.ts
 * @module http/routes
 *
 * Rotas de backup e restore do HUB Central. Operação de alto risco, restrita ao
 * namespace administrativo `core:backup:gerenciar` (SuperAdministrador).
 */

import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createReadStream } from "node:fs";
import { withTransaction } from "../../core/db/pool.js";
import { authorize } from "../../core/iam/rbac.js";
import { log as auditLog } from "../../core/audit/audit-logger.js";
import { createBackup, restoreBackup } from "../../core/backup/backup-service.js";

/** Permissão exigida para backup/restore. */
const BACKUP_NS = "core:backup:gerenciar";

/**
 * Registra as rotas de backup e restore.
 *
 * @param app - Instância Fastify.
 * @param pool - Pool de conexões.
 */
export function registerBackupRoutes(app: FastifyInstance, pool: Pool): void {
  // Gera e baixa um pacote de backup (banco + uploads).
  app.get("/api/backup", async (request, reply) => {
    await withTransaction(pool, async (c) => {
      await authorize(c, request.userId, BACKUP_NS);
      await auditLog(c, { userId: request.userId, module: "core", action: "BACKUP_GERADO", payloadAfter: {} });
    });
    const archive = await createBackup();
    const filename = path.basename(archive);
    void reply.header("Content-Type", "application/gzip");
    void reply.header("Content-Disposition", `attachment; filename="${filename}"`);
    return reply.send(createReadStream(archive));
  });

  // Restaura a partir de um pacote de backup enviado (multipart).
  app.post("/api/backup/restore", async (request, reply) => {
    await withTransaction(pool, (c) => authorize(c, request.userId, BACKUP_NS));

    const file = await request.file();
    if (!file) {
      return reply.status(400).send({ code: "BACKUP_INVALID", message: "Nenhum arquivo enviado.", details: {} });
    }
    const work = await fs.mkdtemp(path.join(os.tmpdir(), "hub-restore-upload-"));
    const uploaded = path.join(work, "backup.tar.gz");
    await fs.writeFile(uploaded, await file.toBuffer());

    try {
      await restoreBackup(uploaded);
    } finally {
      await fs.rm(work, { recursive: true, force: true });
    }

    await withTransaction(pool, async (c) => {
      await auditLog(c, { userId: request.userId, module: "core", action: "BACKUP_RESTAURADO", payloadAfter: {} });
    });
    return reply.send({ ok: true });
  });
}
