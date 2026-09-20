/**
 * @file module.tsx
 * @module modules/contacts
 *
 * Módulo da Base Central de Contatos: gestão de pessoas e empresas (leads ou
 * não), com rótulos. É a fundação referenciada por CRM, Projetos e campanhas.
 */

import ContactsIcon from "@mui/icons-material/Contacts";
import type { ModuleDefinition } from "../../core/modules/types.js";
import { ContactsPage } from "./ContactsPage.js";

/** Módulo de Contatos (núcleo). */
export const contactsModule: ModuleDefinition = {
  id: "contatos",
  title: "Contatos",
  basePath: "/contatos",
  requiredNamespace: "core:contatos:visualizar",
  menu: [
    { label: "Contatos", path: "/contatos", icon: ContactsIcon, requiredNamespace: "core:contatos:visualizar" },
  ],
  routes: [
    { path: "contatos", element: <ContactsPage /> },
  ],
};
