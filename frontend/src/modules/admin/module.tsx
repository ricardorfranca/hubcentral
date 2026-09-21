/**
 * @file module.tsx
 * @module modules/admin
 *
 * Módulo de Administração (núcleo): gestão de usuários e permissões. Registrado
 * como um módulo frontend como qualquer outro, protegido pelo namespace
 * `core:usuarios:gerenciar`.
 */

import PeopleIcon from "@mui/icons-material/People";
import TuneIcon from "@mui/icons-material/Tune";
import ViewListIcon from "@mui/icons-material/ViewList";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import DownloadIcon from "@mui/icons-material/Download";
import type { ModuleDefinition } from "../../core/modules/types.js";
import { UsersPage } from "./UsersPage.js";
import { SettingsPage } from "./SettingsPage.js";
import { CustomFieldsPage } from "./CustomFieldsPage.js";
import { ImportWizardPage } from "./ImportWizardPage.js";
import { ExportWizardPage } from "./ExportWizardPage.js";
import { SuperadminGuard } from "./SuperadminGuard.js";

/** Módulo de administração de usuários e configurações do sistema. */
export const adminModule: ModuleDefinition = {
  id: "admin",
  title: "Administração",
  basePath: "/admin",
  requiredNamespace: "core:usuarios:gerenciar",
  menu: [
    { label: "Usuários", path: "/admin/usuarios", icon: PeopleIcon, requiredNamespace: "core:usuarios:gerenciar" },
    { label: "Campos personalizados", path: "/admin/campos-personalizados", icon: ViewListIcon, requiredNamespace: "core:config:gerenciar" },
    { label: "Configurações", path: "/admin/configuracoes", icon: TuneIcon, requiredNamespace: "core:config:gerenciar" },
    // Import/Export são exclusivos do SuperAdministrador. O menu usa o namespace
    // de backup (território de superadmin) e as páginas reforçam com SuperadminGuard.
    { label: "Importar dados", path: "/admin/importar", icon: UploadFileIcon, requiredNamespace: "core:backup:gerenciar" },
    { label: "Exportar dados", path: "/admin/exportar", icon: DownloadIcon, requiredNamespace: "core:backup:gerenciar" },
  ],
  routes: [
    { path: "admin/usuarios", element: <UsersPage /> },
    { path: "admin/campos-personalizados", element: <CustomFieldsPage /> },
    { path: "admin/configuracoes", element: <SettingsPage /> },
    { path: "admin/importar", element: <SuperadminGuard><ImportWizardPage /></SuperadminGuard> },
    { path: "admin/exportar", element: <SuperadminGuard><ExportWizardPage /></SuperadminGuard> },
  ],
};
