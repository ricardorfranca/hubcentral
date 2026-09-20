/**
 * @file module.tsx
 * @module modules/projetos
 *
 * Definição do módulo de Projetos Internos para o Registro_Modulos. Declara
 * menu e rotas; o Shell os agrega sem conhecer o módulo.
 */

import FolderIcon from "@mui/icons-material/Folder";
import type { ModuleDefinition } from "../../core/modules/types.js";
import { ProjectsPage } from "./ProjectsPage.js";
import { ProjectDetailPage } from "./ProjectDetailPage.js";

/** Módulo de Projetos Internos: projetos, Kanban de tarefas, comentários e anexos. */
export const projetosModule: ModuleDefinition = {
  id: "projetos",
  title: "Projetos Internos",
  basePath: "/projetos",
  requiredNamespace: "projetos:projeto:visualizar",
  menu: [
    { label: "Projetos", path: "/projetos", icon: FolderIcon, requiredNamespace: "projetos:projeto:visualizar" },
  ],
  routes: [
    { path: "projetos", element: <ProjectsPage /> },
    { path: "projetos/:id", element: <ProjectDetailPage /> },
    { path: "projetos/:id/tarefas/:taskId", element: <ProjectDetailPage /> },
  ],
};
