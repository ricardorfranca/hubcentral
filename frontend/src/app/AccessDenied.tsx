/**
 * @file AccessDenied.tsx
 * @module app
 *
 * Página exibida quando o usuário acessa uma rota sem permissão (Req 2.5).
 */

import { Box, Typography } from "@mui/material";

/**
 * Página de acesso negado.
 *
 * @returns Mensagem de acesso negado.
 */
export function AccessDenied(): JSX.Element {
  return (
    <Box sx={{ textAlign: "center", mt: 8 }}>
      <Typography variant="h4" gutterBottom>
        Acesso negado
      </Typography>
      <Typography color="text.secondary">
        Você não tem permissão para acessar esta área.
      </Typography>
    </Box>
  );
}
