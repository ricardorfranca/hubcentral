/**
 * @file LoginPage.tsx
 * @module core/auth
 *
 * Tela de login. Autentica via IAM, registra a sessão e redireciona; se o
 * usuário precisa trocar a senha, encaminha para a tela de definição de senha.
 */

import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Box, Button, Card, CardContent, TextField, Typography, Alert } from "@mui/material";
import { login } from "../api/auth.js";
import { ApiError } from "../api/client.js";
import { useSessionStore } from "./session-store.js";
import { useBrandingStore } from "../branding/branding-store.js";

/**
 * Página de login do HUB Central.
 *
 * @returns O formulário de login.
 */
export function LoginPage(): JSX.Element {
  const navigate = useNavigate();
  const setSession = useSessionStore((s) => s.setSession);
  const systemName = useBrandingStore((s) => s.systemName);
  const logoUrl = useBrandingStore((s) => s.logoUrl);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await login(email, password);
      setSession(res.token, res.user, res.permissions);
      navigate(res.must_change_password ? "/definir-senha" : "/", { replace: true });
    } catch (err) {
      // Mensagem genérica: não revela qual campo falhou (Req 1.2).
      setError(err instanceof ApiError ? "Credenciais inválidas." : "Falha ao entrar.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Box sx={{ minHeight: "100vh", display: "grid", placeItems: "center", bgcolor: "background.default" }}>
      <Card sx={{ width: 380, maxWidth: "90vw" }}>
        <CardContent>
          <Box sx={{ textAlign: "center", mb: 2 }}>
            {logoUrl ? (
              <img src={logoUrl} alt={systemName} style={{ maxHeight: 48 }} />
            ) : (
              <Typography variant="h5" fontWeight={700}>
                {systemName}
              </Typography>
            )}
          </Box>
          <form onSubmit={onSubmit}>
            {error && (
              <Alert severity="error" sx={{ mb: 2 }}>
                {error}
              </Alert>
            )}
            <TextField
              label="E-mail"
              type="email"
              fullWidth
              margin="normal"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
              required
            />
            <TextField
              label="Senha"
              type="password"
              fullWidth
              margin="normal"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <Button type="submit" variant="contained" fullWidth sx={{ mt: 2 }} disabled={loading}>
              {loading ? "Entrando..." : "Entrar"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </Box>
  );
}
