import { describe, it, expect, afterAll } from "vitest";
import { withRollback, closeTestPool } from "../helpers/db.js";
import { getSmtpConfig } from "../../src/core/email/email-service.js";
import { setSetting } from "../../src/core/settings/settings-service.js";

/**
 * @file email.test.ts
 *
 * Testes da resolução de configuração SMTP (Onda B). O envio real não é testado
 * aqui (depende de servidor externo); validamos a leitura/validação da config.
 */

afterAll(async () => {
  await closeTestPool();
});

describe("Configuração SMTP", () => {
  it("lança SMTP_NOT_CONFIGURED sem host/remetente", async () => {
    await withRollback(async (client) => {
      // As chaves existem (seed) mas sem valor => não configurado.
      await expect(getSmtpConfig(client)).rejects.toMatchObject({ code: "SMTP_NOT_CONFIGURED" });
    });
  });

  it("resolve a config quando host e remetente estão definidos", async () => {
    await withRollback(async (client) => {
      await setSetting(client, "core.smtp.host", "smtp.exemplo.com");
      await setSetting(client, "core.smtp.from", "no-reply@exemplo.com");
      await setSetting(client, "core.smtp.port", "465");
      await setSetting(client, "core.smtp.secure", "true");
      const cfg = await getSmtpConfig(client);
      expect(cfg.host).toBe("smtp.exemplo.com");
      expect(cfg.from).toBe("no-reply@exemplo.com");
      expect(cfg.port).toBe(465);
      expect(cfg.secure).toBe(true);
    });
  });
});
