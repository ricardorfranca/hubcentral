/**
 * @file SetPasswordPage.tsx
 * @module core/auth
 *
 * Tela de definição de nova senha (primeiro acesso ou troca). Exige mínimo de
 * 6 caracteres, coerente com a política do IAM.
 */

import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Box, Button, Card, CardContent, TextField, Typography, Alert } from "@mui/material";
import { setPassword } from "../api/auth.js";
import { ApiError } from "../api/client.js";

/** Comprimento mínimo da senha (espelha o backend). */
const MIN_LENGTH = 6;

/**
 * Página de definição de senha.
 *
 * @returns O formulário de nova senha.
 */
export function SetPasswordPage(): JSX.Element {
  const navigate = useNavigate();
  const [pwd, setPwd] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    if (pwd.length < MIN_LENGTH) {
      setError(`A senha deve ter ao menos ${MIN_LENGTH} caracteres.`);
      return;
    }
    if (pwd !== confirm) {
      setError("As senhas não coincidem.");
      return;
    }
    setLoading(true);
    try {
      await setPassword(pwd);
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao definir a senha.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Box sx={{ minHeight: "100vh", display: "grid", placeItems: "center", bgcolor: "background.default" }}>
      <Card sx={{ width: 380, maxWidth: "90vw" }}>
        <CardContent>
          <Typography variant="h6" sx={{ mb: 2 }}>
            Defina sua nova senha
          </Typography>
          <form onSubmit={onSubmit}>
            {error && (
              <Alert severity="error" sx={{ mb: 2 }}>
                {error}
              </Alert>
            )}
            <TextField
              label="Nova senha"
              type="password"
              fullWidth
              margin="normal"
              value={pwd}
              onChange={(e) => setPwd(e.target.value)}
              autoFocus
              required
            />
            <TextField
              label="Confirmar senha"
              type="password"
              fullWidth
              margin="normal"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
            />
            <Button type="submit" variant="contained" fullWidth sx={{ mt: 2 }} disabled={loading}>
              {loading ? "Salvando..." : "Salvar"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </Box>
  );
}
