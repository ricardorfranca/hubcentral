/**
 * @file ThemeProvider.tsx
 * @module core/branding
 *
 * Provedor de tema MUI que deriva o tema das cores do branding em tempo de
 * execução. Alterar o branding reflete no tema sem recompilar (Req 3.2).
 */

import { useMemo, type ReactNode } from "react";
import { createTheme, ThemeProvider as MuiThemeProvider, CssBaseline } from "@mui/material";
import { useBrandingStore } from "./branding-store.js";

/**
 * Envolve a aplicação com o tema Material derivado do branding atual.
 *
 * @param props.children - Árvore da aplicação.
 * @returns O provedor de tema com CssBaseline.
 */
export function ThemeProvider({ children }: { children: ReactNode }): JSX.Element {
  const primary = useBrandingStore((s) => s.primaryColor);
  const secondary = useBrandingStore((s) => s.secondaryColor);
  const mode = useBrandingStore((s) => s.mode);

  const theme = useMemo(
    () =>
      createTheme({
        palette: {
          mode,
          primary: { main: primary },
          secondary: { main: secondary },
        },
        shape: { borderRadius: 8 },
      }),
    [primary, secondary, mode],
  );

  return (
    <MuiThemeProvider theme={theme}>
      <CssBaseline />
      {children}
    </MuiThemeProvider>
  );
}
