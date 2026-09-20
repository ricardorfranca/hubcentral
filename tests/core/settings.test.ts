import { describe, it, expect, afterAll } from "vitest";
import { withRollback, closeTestPool } from "../helpers/db.js";
import {
  registerSetting, getSetting, setSetting, listSettings,
  getSettingInt, getSettingList, resolveValue,
} from "../../src/core/settings/settings-service.js";

/**
 * @file settings.test.ts
 *
 * Testes da Central de Configurações do núcleo (Fase 1): registro idempotente,
 * precedência persistido -> default -> env, e helpers tipados.
 */

afterAll(async () => {
  await closeTestPool();
});

let seq = 0;
function key(): string {
  seq += 1;
  return `teste.config.k${seq}_${Math.random().toString(36).slice(2)}`;
}

describe("Central de Configurações", () => {
  it("registra idempotente e resolve o default quando sem valor", async () => {
    await withRollback(async (client) => {
      const k = key();
      await registerSetting(client, { key: k, module: "projetos", valueType: "int", label: "Máx", defaultValue: "100" });
      // Re-registrar não apaga metadados nem cria duplicata.
      await registerSetting(client, { key: k, module: "projetos", valueType: "int", label: "Máximo", defaultValue: "100" });

      const s = await getSetting(client, k);
      expect(s?.label).toBe("Máximo");
      expect(s?.value).toBeNull();
      expect(await resolveValue(client, k)).toBe("100"); // usa default
      expect(await getSettingInt(client, k, 0)).toBe(100);
    });
  });

  it("valor persistido prevalece sobre o default", async () => {
    await withRollback(async (client) => {
      const k = key();
      await registerSetting(client, { key: k, module: "projetos", valueType: "int", label: "Máx", defaultValue: "100" });
      await setSetting(client, k, "250");
      expect(await getSettingInt(client, k, 0)).toBe(250);
    });
  });

  it("env é fallback quando não há valor nem default", async () => {
    await withRollback(async (client) => {
      const k = key();
      await registerSetting(client, { key: k, module: "projetos", valueType: "int", label: "Máx" });
      process.env.TEST_SETTING_ENV = "77";
      expect(await resolveValue(client, k, "TEST_SETTING_ENV")).toBe("77");
      delete process.env.TEST_SETTING_ENV;
    });
  });

  it("getSettingList normaliza CSV (minúsculas, sem espaços)", async () => {
    await withRollback(async (client) => {
      const k = key();
      await registerSetting(client, { key: k, module: "projetos", valueType: "csv", label: "Tipos", defaultValue: "PDF, PNG , Docx" });
      expect(await getSettingList(client, k, [])).toEqual(["pdf", "png", "docx"]);
    });
  });

  it("listSettings filtra e agrupa por módulo", async () => {
    await withRollback(async (client) => {
      const k1 = key();
      const k2 = key();
      await registerSetting(client, { key: k1, module: "projetos", valueType: "string", label: "A" });
      await registerSetting(client, { key: k2, module: "projetos", valueType: "string", label: "B" });
      const list = await listSettings(client, { module: "projetos" });
      expect(list.filter((s) => s.key === k1 || s.key === k2)).toHaveLength(2);
      expect(list.every((s) => s.module === "projetos")).toBe(true);
    });
  });

  it("setSetting em chave inexistente lança SETTING_NOT_FOUND", async () => {
    await withRollback(async (client) => {
      await expect(setSetting(client, "nao.existe.aqui", "x")).rejects.toMatchObject({ code: "SETTING_NOT_FOUND" });
    });
  });
});
