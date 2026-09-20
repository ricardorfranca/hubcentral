/**
 * @file module.tsx
 * @module modules/account
 *
 * Módulo "Minha conta" (núcleo): autoatendimento disponível a qualquer usuário
 * autenticado, sem namespace RBAC. Hoje expõe a configuração do canal de
 * WhatsApp do próprio usuário (Evolution API).
 */

import WhatsAppIcon from "@mui/icons-material/WhatsApp";
import type { ModuleDefinition } from "../../core/modules/types.js";
import { MyChannelPage } from "./MyChannelPage.js";

/** Módulo de autoatendimento do usuário. */
export const accountModule: ModuleDefinition = {
  id: "account",
  title: "Minha conta",
  basePath: "/minha-conta",
  menu: [
    { label: "Meu canal de WhatsApp", path: "/minha-conta/whatsapp", icon: WhatsAppIcon },
  ],
  routes: [
    { path: "minha-conta/whatsapp", element: <MyChannelPage /> },
  ],
};
