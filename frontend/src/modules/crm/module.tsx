/**
 * @file module.tsx
 * @module modules/crm
 *
 * Definição do módulo CRM para o Registro_Modulos. Declara menu e rotas; o
 * Shell/App os agregam sem conhecer o CRM especificamente.
 */

import ViewKanbanIcon from "@mui/icons-material/ViewKanban";
import CampaignIcon from "@mui/icons-material/Campaign";
import BarChartIcon from "@mui/icons-material/BarChart";
import ForumIcon from "@mui/icons-material/Forum";
import SettingsIcon from "@mui/icons-material/Settings";
import type { ModuleDefinition } from "../../core/modules/types.js";
import { KanbanBoard } from "./KanbanBoard.js";
import { LeadDetailPage } from "./LeadDetailPage.js";
import { CampaignsPage } from "./CampaignsPage.js";
import { ReportsPage } from "./ReportsPage.js";
import { ConversationsPage } from "./ConversationsPage.js";
import { SettingsPage } from "./SettingsPage.js";

/** Módulo CRM: pipeline Kanban e detalhe de lead. */
export const crmModule: ModuleDefinition = {
  id: "crm",
  title: "CRM",
  basePath: "/crm",
  requiredNamespace: "crm:pipeline:visualizar",
  menu: [
    { label: "Pipeline", path: "/crm", icon: ViewKanbanIcon, requiredNamespace: "crm:pipeline:visualizar" },
    { label: "Campanhas", path: "/crm/campanhas", icon: CampaignIcon, requiredNamespace: "crm:campanhas:visualizar" },
    { label: "Relatórios", path: "/crm/relatorios", icon: BarChartIcon, requiredNamespace: "crm:relatorios:fechamentos" },
    { label: "Conversas", path: "/crm/conversas", icon: ForumIcon, requiredNamespace: "crm:conversas:visualizar" },
    { label: "Configurações", path: "/crm/configuracoes", icon: SettingsIcon, requiredNamespace: "crm:config:listas" },
  ],
  routes: [
    { path: "crm", element: <KanbanBoard /> },
    { path: "crm/leads/:id", element: <LeadDetailPage /> },
    { path: "crm/campanhas", element: <CampaignsPage /> },
    { path: "crm/relatorios", element: <ReportsPage /> },
    { path: "crm/conversas", element: <ConversationsPage /> },
    { path: "crm/configuracoes", element: <SettingsPage /> },
  ],
};
