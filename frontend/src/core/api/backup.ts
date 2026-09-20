/**
 * @file backup.ts
 * @module core/api
 *
 * Cliente de backup/restore (superadmin). O download usa fetch direto para
 * receber o binário; o restore envia o arquivo via multipart.
 */

import { getToken } from "../auth/session-store.js";

/** Baixa o pacote de backup e dispara o download no navegador. */
export async function downloadBackup(): Promise<void> {
  const token = getToken();
  const res = await fetch("/api/backup", {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: "Falha ao gerar backup." }));
    throw new Error(body.message ?? "Falha ao gerar backup.");
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `hubcentral-backup-${new Date().toISOString().slice(0, 10)}.tar.gz`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Restaura a partir de um pacote de backup. */
export async function restoreBackup(file: File): Promise<{ ok: boolean }> {
  const token = getToken();
  const form = new FormData();
  form.append("file", file);
  const res = await fetch("/api/backup/restore", {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: "Falha ao restaurar backup." }));
    throw new Error(body.message ?? "Falha ao restaurar backup.");
  }
  return res.json() as Promise<{ ok: boolean }>;
}
