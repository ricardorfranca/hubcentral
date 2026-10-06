/**
 * @file Shell.tsx
 * @module app
 *
 * Casca da aplicação: cabeçalho (logo/branding + usuário), barra lateral de
 * navegação montada a partir do Registro_Modulos (filtrada por RBAC) e área de
 * conteúdo. Não contém código específico de módulo (Req 2.1, 2.4).
 */

import { useState, type ReactNode } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  AppBar, Box, Drawer, IconButton, List, ListItemButton, ListItemIcon, ListItemText,
  Toolbar, Typography, Menu, MenuItem, Divider,
} from "@mui/material";
import MenuIcon from "@mui/icons-material/Menu";
import MenuOpenIcon from "@mui/icons-material/MenuOpen";
import AccountCircle from "@mui/icons-material/AccountCircle";
import DarkModeIcon from "@mui/icons-material/DarkMode";
import LightModeIcon from "@mui/icons-material/LightMode";
import { ListSubheader, Box as MuiBox, Tooltip, Stack } from "@mui/material";
import { MODULE_REGISTRY } from "../core/modules/registry.js";
import { useCan } from "../core/rbac/can.js";
import { useBrandingStore } from "../core/branding/branding-store.js";
import { useSessionStore } from "../core/auth/session-store.js";
import { logout as apiLogout } from "../core/api/auth.js";
import { NotificationBell } from "../core/notifications/NotificationBell.js";

const DRAWER_WIDTH = 248;
const COLLAPSED_WIDTH = 64;
const SIDEBAR_KEY = "hubcentral.sidebar.collapsed";
// Versão instalada, injetada em build pelo Vite (ver vite.config.ts).
const APP_VERSION = __APP_VERSION__;

/**
 * Renderiza a casca com a navegação por módulos e a área de conteúdo.
 *
 * @param props.children - Conteúdo da rota atual.
 * @returns O layout da aplicação.
 */
export function Shell({ children }: { children: ReactNode }): JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  const can = useCan();
  const systemName = useBrandingStore((s) => s.systemName);
  const logoUrl = useBrandingStore((s) => s.logoUrl);
  const mode = useBrandingStore((s) => s.mode);
  const toggleMode = useBrandingStore((s) => s.toggleMode);
  const user = useSessionStore((s) => s.user);
  const clear = useSessionStore((s) => s.clear);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [anchor, setAnchor] = useState<null | HTMLElement>(null);
  // Preferência de layout: menu lateral recolhido (apenas no drawer permanente).
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return typeof window !== "undefined" && window.localStorage.getItem(SIDEBAR_KEY) === "1";
    } catch {
      return false;
    }
  });

  const toggleCollapsed = (): void =>
    setCollapsed((v) => {
      const next = !v;
      try {
        window.localStorage.setItem(SIDEBAR_KEY, next ? "1" : "0");
      } catch {
        // Ignora indisponibilidade de localStorage.
      }
      return next;
    });

  // Largura efetiva do drawer permanente conforme o estado de recolhimento.
  const drawerWidth = collapsed ? COLLAPSED_WIDTH : DRAWER_WIDTH;

  const isSuperadmin = user?.role === "superadmin";

  // Menu agrupado por módulo: para cada módulo permitido, os itens que o
  // usuário pode ver. Itens `superadminOnly` só aparecem para o
  // SuperAdministrador (por papel), independente dos namespaces da sessão.
  // Módulos sem nenhum item visível são omitidos.
  const menuGroups = MODULE_REGISTRY
    .filter((m) => can(m.requiredNamespace))
    .map((m) => ({
      title: m.title,
      items: m.menu.filter(
        (entry) => can(entry.requiredNamespace) && (!entry.superadminOnly || isSuperadmin),
      ),
    }))
    .filter((g) => g.items.length > 0);

  async function handleLogout(): Promise<void> {
    setAnchor(null);
    try {
      await apiLogout();
    } catch {
      // Ignora erro de rede no logout; limpa sessão local de qualquer forma.
    }
    clear();
    navigate("/login", { replace: true });
  }

  // Renderiza o conteúdo do drawer. O mobile sempre recebe `isCollapsed=false`
  // (modo expandido). O drawer permanente passa o estado real de recolhimento.
  // Layout em coluna: a navegação ocupa o topo e o rodapé (versão + crédito)
  // fica fixado ao final da coluna da esquerda.
  const renderDrawer = (isCollapsed: boolean): JSX.Element => (
    <Box
      role="navigation"
      sx={{ display: "flex", flexDirection: "column", height: "100%" }}
    >
      {/* Alinha o início da navegação abaixo do AppBar fixo. */}
      <Toolbar />
      <Divider />
      <Box sx={{ flexGrow: 1, overflowY: "auto" }}>
        {menuGroups.map((group, gi) => (
          <List
            key={group.title}
            subheader={
              isCollapsed ? undefined : (
                <ListSubheader component="div" disableSticky>{group.title}</ListSubheader>
              )
            }
            sx={{ borderTop: gi > 0 ? 1 : 0, borderColor: "divider" }}
          >
            {group.items.map((entry) => {
              const Icon = entry.icon;
              const selected = location.pathname.startsWith(entry.path);
              const button = (
                <ListItemButton
                  key={entry.path}
                  selected={selected}
                  onClick={() => {
                    navigate(entry.path);
                    setMobileOpen(false);
                  }}
                  sx={isCollapsed ? { justifyContent: "center", px: 2.5 } : {}}
                >
                  <ListItemIcon
                    sx={isCollapsed ? { minWidth: 0, mr: "auto", justifyContent: "center" } : {}}
                  >
                    <Icon />
                  </ListItemIcon>
                  {!isCollapsed && <ListItemText primary={entry.label} />}
                </ListItemButton>
              );
              return isCollapsed ? (
                <Tooltip key={entry.path} title={entry.label} placement="right">
                  {button}
                </Tooltip>
              ) : (
                button
              );
            })}
          </List>
        ))}
      </Box>

      {/* Rodapé da coluna esquerda: versão instalada e crédito discreto. */}
      <Divider />
      <Box sx={{ p: isCollapsed ? 1 : 1.5, textAlign: "center" }}>
        {isCollapsed ? (
          <Tooltip title={`Versão ${APP_VERSION} — Grupo RFTecnologia`} placement="right">
            <Typography variant="caption" color="text.secondary" noWrap>
              v{APP_VERSION}
            </Typography>
          </Tooltip>
        ) : (
          <Stack spacing={0.25}>
            <Typography variant="caption" color="text.secondary" noWrap>
              Versão {APP_VERSION}
            </Typography>
            <Typography variant="caption" color="text.disabled" noWrap>
              Grupo RFTecnologia
            </Typography>
          </Stack>
        )}
      </Box>
    </Box>
  );

  return (
    <Box sx={{ display: "flex", minHeight: "100vh" }}>
      <AppBar position="fixed" sx={{ zIndex: (t) => t.zIndex.drawer + 1 }}>
        <Toolbar>
          {/* Mobile: abre/fecha o drawer temporário. */}
          <IconButton
            color="inherit"
            edge="start"
            onClick={() => setMobileOpen((v) => !v)}
            sx={{ mr: 2, display: { sm: "none" } }}
            aria-label="abrir menu"
          >
            <MenuIcon />
          </IconButton>
          {/* Desktop: recolhe/expande o menu lateral permanente. */}
          <Tooltip title={collapsed ? "Expandir menu" : "Recolher menu"}>
            <IconButton
              color="inherit"
              edge="start"
              onClick={toggleCollapsed}
              sx={{ mr: 2, display: { xs: "none", sm: "inline-flex" } }}
              aria-label={collapsed ? "expandir menu" : "recolher menu"}
            >
              {collapsed ? <MenuIcon /> : <MenuOpenIcon />}
            </IconButton>
          </Tooltip>
          <MuiBox sx={{ display: "flex", alignItems: "center", gap: 1, flexGrow: 1 }}>
            {logoUrl && (
              <MuiBox
                component="img"
                src={logoUrl}
                alt={systemName}
                sx={{ height: 32, width: "auto", maxWidth: 160, objectFit: "contain" }}
              />
            )}
            <Typography variant="h6" noWrap>{systemName}</Typography>
          </MuiBox>
          <Tooltip title={mode === "dark" ? "Modo claro" : "Modo escuro"}>
            <IconButton color="inherit" onClick={toggleMode} aria-label="alternar tema">
              {mode === "dark" ? <LightModeIcon /> : <DarkModeIcon />}
            </IconButton>
          </Tooltip>
          <NotificationBell />
          <IconButton color="inherit" onClick={(e) => setAnchor(e.currentTarget)} aria-label="conta">
            <AccountCircle />
          </IconButton>
          <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
            <MenuItem disabled>{user?.email}</MenuItem>
            <Divider />
            <MenuItem onClick={handleLogout}>Sair</MenuItem>
          </Menu>
        </Toolbar>
      </AppBar>

      <Box component="nav" sx={{ width: { sm: drawerWidth }, flexShrink: { sm: 0 } }}>
        <Drawer
          variant="temporary"
          open={mobileOpen}
          onClose={() => setMobileOpen(false)}
          ModalProps={{ keepMounted: true }}
          sx={{ display: { xs: "block", sm: "none" }, "& .MuiDrawer-paper": { width: DRAWER_WIDTH } }}
        >
          {renderDrawer(false)}
        </Drawer>
        <Drawer
          variant="permanent"
          open
          sx={{
            display: { xs: "none", sm: "block" },
            "& .MuiDrawer-paper": {
              width: drawerWidth,
              overflowX: "hidden",
              transition: (t) => t.transitions.create("width", { duration: t.transitions.duration.shorter }),
            },
          }}
        >
          {renderDrawer(collapsed)}
        </Drawer>
      </Box>

      <Box component="main" sx={{ flexGrow: 1, p: 3, width: { sm: `calc(100% - ${drawerWidth}px)` } }}>
        <Toolbar />
        {children}
      </Box>
    </Box>
  );
}
