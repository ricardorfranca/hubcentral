/**
 * @file types.ts
 * @module core/modules
 *
 * Contrato de módulo frontend — o análogo, no cliente, do manifesto de módulo
 * do backend. Um módulo declara seus itens de menu e rotas; o Shell os agrega
 * a partir do Registro, sem código específico de módulo.
 */

import type { ComponentType, ReactNode } from "react";
import type { RouteObject } from "react-router-dom";

/** Item de navegação de um módulo. */
export interface MenuEntry {
  /** Rótulo exibido. */
  label: string;
  /** Caminho absoluto (ex.: `/crm`). */
  path: string;
  /** Ícone MUI. */
  icon: ComponentType;
  /** Namespace RBAC exigido para exibir (opcional). */
  requiredNamespace?: string;
  /**
   * Se `true`, o item só aparece para SuperAdministradores (papel), independente
   * dos namespaces da sessão. Usado por áreas de alto risco (ex.: assistentes de
   * importação/exportação) cujo acesso é exclusivo do SuperAdministrador.
   */
  superadminOnly?: boolean;
}

/** Definição de um módulo frontend. */
export interface ModuleDefinition {
  /** Identificador (ex.: `crm`). */
  id: string;
  /** Título do módulo. */
  title: string;
  /** Prefixo de rota (ex.: `/crm`). */
  basePath: string;
  /** Namespace RBAC exigido para o módulo aparecer (opcional). */
  requiredNamespace?: string;
  /** Itens de menu do módulo. */
  menu: MenuEntry[];
  /** Rotas React Router do módulo. */
  routes: RouteObject[];
}

/** Elemento renderizável de um módulo (reexport de conveniência). */
export type ModuleElement = ReactNode;
