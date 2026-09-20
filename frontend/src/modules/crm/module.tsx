/**
 * @file module.tsx
 * @module modules/crm
 *
 * Definição do módulo CRM 2.0 (Receita Previsível) para o Registro_Modulos.
 * Declara menu e rotas; o Shell/App os agregam sem conhecer o CRM. Contas e
 * oportunidades são o núcleo; atividades, dashboards, conversas, campanhas e
 * configurações completam a operação de vendas B2B.
 */

import BusinessIcon from "@mui/icons-material/Business";
import ViewKanbanIcon from "@mui/icons-material/ViewKanban";
import ChecklistIcon from "@mui/icons-material/Checklist";
import InsightsIcon from "@mui/icons-material/Insights";
import CampaignIcon from "@mui/icons-material/Campaign";
import BarChartIcon from "@mui/icons-material/BarChart";
import ForumIcon from "@mui/icons-material/Forum";
import SettingsIcon from "@mui/icons-material/Settings";
import type { ModuleDefinition } from "../../core/modules/types.js";
import { AccountsPage } from "./AccountsPage.js";
import { AccountDetailPage } from "./AccountDetailPage.js";
import { OpportunitiesBoard } from "./OpportunitiesBoard.js";
import { OpportunityDetailPage } from "./OpportunityDetailPage.js";
import { ActivitiesPage } from "./ActivitiesPage.js";
import { ForecastDashboard } from "./ForecastDashboard.js";
import { CampaignsPage } from "./CampaignsPage.js";
import { ReportsPage } from "./ReportsPage.js";
import { ConversationsPage } from "./ConversationsPage.js";
import { SettingsPage } from "./SettingsPage.js";

/** Módulo CRM 2.0: contas, oportunidades, atividades e Receita Previsível. */
export const crmModule: ModuleDefinition = {
  id: "crm",
  title: "CRM",
  basePath: "/crm",
  requiredNamespace: "crm:oportunidades:visualizar",
  menu: [
    { label: "Oportunidades", path: "/crm", icon: ViewKanbanIcon, requiredNamespace: "crm:oportunidades:visualizar" },
    { label: "Contas", path: "/crm/contas", icon: BusinessIcon, requiredNamespace: "crm:contas:visualizar" },
    { label: "Atividades", path: "/crm/atividades", icon: ChecklistIcon, requiredNamespace: "crm:atividades:visualizar" },
    { label: "Receita Previsível", path: "/crm/dashboards", icon: InsightsIcon, requiredNamespace: "crm:forecast:visualizar" },
    { label: "Conversas", path: "/crm/conversas", icon: ForumIcon, requiredNamespace: "crm:conversas:visualizar" },
    { label: "Campanhas", path: "/crm/campanhas", icon: CampaignIcon, requiredNamespace: "crm:campanhas:visualizar" },
    { label: "Relatórios", path: "/crm/relatorios", icon: BarChartIcon, requiredNamespace: "crm:relatorios:fechamentos" },
    { label: "Configurações", path: "/crm/configuracoes", icon: SettingsIcon, requiredNamespace: "crm:config:listas" },
  ],
  routes: [
    { path: "crm", element: <OpportunitiesBoard /> },
    { path: "crm/oportunidades/:id", element: <OpportunityDetailPage /> },
    { path: "crm/contas", element: <AccountsPage /> },
    { path: "crm/contas/:id", element: <AccountDetailPage /> },
    { path: "crm/atividades", element: <ActivitiesPage /> },
    { path: "crm/dashboards", element: <ForecastDashboard /> },
    { path: "crm/conversas", element: <ConversationsPage /> },
    { path: "crm/campanhas", element: <CampaignsPage /> },
    { path: "crm/relatorios", element: <ReportsPage /> },
    { path: "crm/configuracoes", element: <SettingsPage /> },
  ],
};
