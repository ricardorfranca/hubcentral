/**
 * @file settings.ts
 * @module http/routes
 *
 * Rotas da Central de Configurações do HUB Central (núcleo). Exigem o namespace
 * administrativo `core:config:gerenciar`. Lista os parâmetros (agrupáveis por
 * módulo na UI) e permite alterar valores.
 */

import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { withTransaction } from "../../core/db/pool.js";
import { authorize } from "../../core/iam/rbac.js";
import { listSettings, setSetting, resolveValue } from "../../core/settings/settings-service.js";
import { promises as fs } from "node:fs";
import path from "node:path";

/** Permissão exigida para gerenciar configurações. */
const CONFIG_NS = "core:config:gerenciar";

/** Diretório base de uploads (mesmo default do módulo de projetos). */
function uploadsBaseDir(): string {
  return process.env.UPLOADS_DIR ?? "/opt/hubcentral/uploads";
}

/**
 * Registra as rotas da Central de Configurações.
 *
 * @param app - Instância Fastify.
 * @param pool - Pool de conexões.
 */
export function registerSettingsRoutes(app: FastifyInstance, pool: Pool): void {
  // Branding público (nome, logo, cores) — sem autenticação, para a tela de
  // login e o boot do portal aplicarem a identidade visual.
  app.get("/api/branding", async (_request, reply) => {
    const branding = await withTransaction(pool, async (c) => ({
      system_name: (await resolveValue(c, "core.branding.system_name")) ?? "HUB Central",
      logo_url: (await resolveValue(c, "core.branding.logo_url")) || null,
      primary_color: (await resolveValue(c, "core.branding.primary_color")) ?? "#e53935",
      secondary_color: (await resolveValue(c, "core.branding.secondary_color")) ?? "#b71c1c",
    }));
    return reply.send(branding);
  });

  // Lista as configurações (opcionalmente filtradas por módulo).
  app.get<{ Querystring: { module?: string } }>("/api/settings", async (request, reply) => {
    const items = await withTransaction(pool, async (c) => {
      await authorize(c, request.userId, CONFIG_NS);
      return listSettings(c, request.query.module ? { module: request.query.module } : {});
    });
    return reply.send(items);
  });

  // Serve arquivos públicos de branding (logotipo). Restrito ao subdiretório
  // de branding e a nomes seguros (sem travessia de diretório).
  app.get<{ Params: { file: string } }>("/uploads/branding/:file", async (request, reply) => {
    const file = request.params.file;
    if (!/^[a-zA-Z0-9._-]+$/.test(file)) {
      return reply.status(400).send({ code: "SETTING_INVALID", message: "Nome inválido.", details: {} });
    }
    const full = path.join(uploadsBaseDir(), "branding", file);
    try {
      const data = await fs.readFile(full);
      const ext = file.split(".").pop()?.toLowerCase();
      const types: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml" };
      void reply.header("Content-Type", types[ext ?? "png"] ?? "application/octet-stream");
      return reply.send(data);
    } catch {
      return reply.status(404).send({ code: "SETTING_NOT_FOUND", message: "Arquivo não encontrado.", details: {} });
    }
  });

  // Upload do logotipo: salva o arquivo em disco e define core.branding.logo_url.
  app.post("/api/settings/branding/logo", async (request, reply) => {
    const file = await request.file();
    if (!file) {
      return reply.status(400).send({ code: "SETTING_INVALID", message: "Nenhum arquivo enviado.", details: {} });
    }
    const content = await file.toBuffer();
    const ext = (file.filename.split(".").pop() ?? "png").toLowerCase().replace(/[^a-z0-9]/g, "");
    const allowed = ["png", "jpg", "jpeg", "gif", "webp", "svg"];
    if (!allowed.includes(ext)) {
      return reply.status(400).send({ code: "SETTING_INVALID", message: "Formato de imagem não suportado.", details: {} });
    }
    const url = await withTransaction(pool, async (c) => {
      await authorize(c, request.userId, CONFIG_NS);
      const dir = path.join(uploadsBaseDir(), "branding");
      await fs.mkdir(dir, { recursive: true });
      const stored = `logo-${Date.now()}.${ext}`;
      await fs.writeFile(path.join(dir, stored), content);
      const publicUrl = `/uploads/branding/${stored}`;
      await setSetting(c, "core.branding.logo_url", publicUrl, request.userId);
      return publicUrl;
    });
    return reply.send({ logo_url: url });
  });

  // Atualiza o valor de um parâmetro (value = null volta ao default).
  app.patch<{ Params: { key: string }; Body: { value: string | null } }>(
    "/api/settings/:key",
    async (request, reply) => {
      const updated = await withTransaction(pool, async (c) => {
        await authorize(c, request.userId, CONFIG_NS);
        return setSetting(c, request.params.key, request.body.value ?? null, request.userId);
      });
      return reply.send(updated);
    },
  );
}
