/**
 * @file registry.ts
 * @module core/modules
 *
 * Registro_Modulos: a lista declarativa de módulos frontend que o Shell agrega
 * para compor navegação e rotas. Adicionar um módulo = incluí-lo aqui; o Shell
 * não muda.
 */

import type { ModuleDefinition } from "./types.js";
import { contactsModule } from "../../modules/contacts/module.js";
import { crmModule } from "../../modules/crm/module.js";
import { projetosModule } from "../../modules/projetos/module.js";
import { adminModule } from "../../modules/admin/module.js";

/** Módulos registrados na aplicação. Contatos primeiro: é a base do sistema. */
export const MODULE_REGISTRY: ModuleDefinition[] = [contactsModule, crmModule, projetosModule, adminModule];
