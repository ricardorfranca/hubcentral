/**
 * @file module.tsx
 * @module modules/crm
 *
 * Definição do módulo CRM para o Registro_Modulos. Declara menu e rotas; o
 * Shell/App os agregam sem conhecer o CRM especificamente.
 */

import ViewKanbanIcon from "@mui/icons-material/ViewKanban";
import type { ModuleDefinition } from "../../core/modules/types.js";
import { KanbanBoard } from "./KanbanBoard.js";
import { LeadDetailPage } from "./LeadDetailPage.js";

/** Módulo CRM: pipeline Kanban e detalhe de lead. */
export const crmModule: ModuleDefinition = {
  id: "crm",
  title: "CRM",
  basePath: "/crm",
  requiredNamespace: "crm:pipeline:visualizar",
  menu: [
    {
      label: "CRM — Pipeline",
      path: "/crm",
      icon: ViewKanbanIcon,
      requiredNamespace: "crm:pipeline:visualizar",
    },
  ],
  routes: [
    { path: "crm", element: <KanbanBoard /> },
    { path: "crm/leads/:id", element: <LeadDetailPage /> },
  ],
};
