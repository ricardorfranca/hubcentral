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
import AccountCircle from "@mui/icons-material/AccountCircle";
import { MODULE_REGISTRY } from "../core/modules/registry.js";
import { useCan } from "../core/rbac/can.js";
import { useBrandingStore } from "../core/branding/branding-store.js";
import { useSessionStore } from "../core/auth/session-store.js";
import { logout as apiLogout } from "../core/api/auth.js";

const DRAWER_WIDTH = 248;

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
  const user = useSessionStore((s) => s.user);
  const clear = useSessionStore((s) => s.clear);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [anchor, setAnchor] = useState<null | HTMLElement>(null);

  // Itens de menu visíveis: de todos os módulos permitidos, respeitando RBAC.
  const menuItems = MODULE_REGISTRY.filter((m) => can(m.requiredNamespace)).flatMap((m) =>
    m.menu.filter((entry) => can(entry.requiredNamespace)),
  );

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

  const drawer = (
    <Box role="navigation">
      <Toolbar>
        <Typography variant="h6" noWrap fontWeight={700}>
          {systemName}
        </Typography>
      </Toolbar>
      <Divider />
      <List>
        {menuItems.map((entry) => {
          const Icon = entry.icon;
          const selected = location.pathname.startsWith(entry.path);
          return (
            <ListItemButton
              key={entry.path}
              selected={selected}
              onClick={() => {
                navigate(entry.path);
                setMobileOpen(false);
              }}
            >
              <ListItemIcon>
                <Icon />
              </ListItemIcon>
              <ListItemText primary={entry.label} />
            </ListItemButton>
          );
        })}
      </List>
    </Box>
  );

  return (
    <Box sx={{ display: "flex", minHeight: "100vh" }}>
      <AppBar position="fixed" sx={{ zIndex: (t) => t.zIndex.drawer + 1 }}>
        <Toolbar>
          <IconButton
            color="inherit"
            edge="start"
            onClick={() => setMobileOpen((v) => !v)}
            sx={{ mr: 2, display: { sm: "none" } }}
            aria-label="abrir menu"
          >
            <MenuIcon />
          </IconButton>
          <Typography variant="h6" noWrap sx={{ flexGrow: 1 }}>
            {systemName}
          </Typography>
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

      <Box component="nav" sx={{ width: { sm: DRAWER_WIDTH }, flexShrink: { sm: 0 } }}>
        <Drawer
          variant="temporary"
          open={mobileOpen}
          onClose={() => setMobileOpen(false)}
          ModalProps={{ keepMounted: true }}
          sx={{ display: { xs: "block", sm: "none" }, "& .MuiDrawer-paper": { width: DRAWER_WIDTH } }}
        >
          {drawer}
        </Drawer>
        <Drawer
          variant="permanent"
          open
          sx={{ display: { xs: "none", sm: "block" }, "& .MuiDrawer-paper": { width: DRAWER_WIDTH } }}
        >
          {drawer}
        </Drawer>
      </Box>

      <Box component="main" sx={{ flexGrow: 1, p: 3, width: { sm: `calc(100% - ${DRAWER_WIDTH}px)` } }}>
        <Toolbar />
        {children}
      </Box>
    </Box>
  );
}
