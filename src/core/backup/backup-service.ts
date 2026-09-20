/**
 * @file backup-service.ts
 * @module core/backup
 *
 * Backup e restore do HUB Central. Um backup empacota (tar.gz) um dump do
 * PostgreSQL (formato custom via `pg_dump`) e o diretório de uploads. O restore
 * recebe esse pacote, restaura o banco (`pg_restore --clean`) e substitui os
 * uploads. Operação de alto risco — restrita ao SuperAdministrador.
 *
 * Requer `pg_dump`/`pg_restore` e `tar` disponíveis no servidor (pacotes
 * postgresql-client e tar, presentes na implantação Debian).
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DomainError, ErrorCode } from "../errors.js";

const execFileAsync = promisify(execFile);

/** Diretório base de uploads. */
function uploadsBaseDir(): string {
  return process.env.UPLOADS_DIR ?? "/opt/hubcentral/uploads";
}

/** URL de conexão do banco. */
function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new DomainError(ErrorCode.BACKUP_ERROR, "DATABASE_URL não configurada.", {});
  return url;
}

/**
 * Gera um pacote de backup (tar.gz) com o dump do banco e os uploads.
 *
 * @returns O caminho do arquivo .tar.gz gerado (num diretório temporário).
 */
export async function createBackup(): Promise<string> {
  const work = await fs.mkdtemp(path.join(os.tmpdir(), "hub-backup-"));
  const dumpPath = path.join(work, "database.dump");
  const uploads = uploadsBaseDir();

  // Dump do banco em formato custom (compactado, restaurável seletivamente).
  await execFileAsync("pg_dump", ["--format=custom", "--file", dumpPath, databaseUrl()]);

  // Copia os uploads para dentro do work dir (se existirem).
  const uploadsCopy = path.join(work, "uploads");
  try {
    await fs.cp(uploads, uploadsCopy, { recursive: true });
  } catch {
    await fs.mkdir(uploadsCopy, { recursive: true });
  }

  // Empacota tudo.
  const archive = path.join(work, `hubcentral-backup-${Date.now()}.tar.gz`);
  await execFileAsync("tar", ["-czf", archive, "-C", work, "database.dump", "uploads"]);
  return archive;
}

/**
 * Restaura um pacote de backup: restaura o banco e substitui os uploads.
 *
 * @param archivePath - Caminho do arquivo .tar.gz enviado.
 * @throws {DomainError} `SMTP_ERROR` (genérico de execução) em falha de restore.
 */
export async function restoreBackup(archivePath: string): Promise<void> {
  const work = await fs.mkdtemp(path.join(os.tmpdir(), "hub-restore-"));
  try {
    await execFileAsync("tar", ["-xzf", archivePath, "-C", work]);
    const dumpPath = path.join(work, "database.dump");
    await fs.access(dumpPath);

    // Restaura o banco, limpando objetos existentes antes.
    await execFileAsync("pg_restore", ["--clean", "--if-exists", "--no-owner", "--dbname", databaseUrl(), dumpPath]);

    // Substitui os uploads.
    const uploadsBackup = path.join(work, "uploads");
    try {
      await fs.access(uploadsBackup);
      const target = uploadsBaseDir();
      await fs.rm(target, { recursive: true, force: true });
      await fs.cp(uploadsBackup, target, { recursive: true });
    } catch {
      // Sem uploads no pacote: mantém os atuais.
    }
  } finally {
    await fs.rm(work, { recursive: true, force: true });
  }
}
