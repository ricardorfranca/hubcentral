/**
 * @file ProjectsPage.tsx
 * @module modules/projetos
 *
 * Lista dos projetos internos do usuário (dono ou membro). Permite criar um
 * novo projeto com nome, descrição curta e descritivo principal.
 */

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Box, Typography, Stack, Button, Table, TableBody, TableCell, TableHead, TableRow,
  Paper, TableContainer, CircularProgress, Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, Alert, Chip,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import { useProjects, useCreateProject } from "./hooks.js";
import { useCan } from "../../core/rbac/can.js";
import { ApiError } from "../../core/api/client.js";

/**
 * Página de listagem de projetos internos.
 *
 * @returns A tela de projetos.
 */
export function ProjectsPage(): JSX.Element {
  const navigate = useNavigate();
  const can = useCan();
  const { data: projects, isLoading } = useProjects();
  const [dialogOpen, setDialogOpen] = useState(false);

  if (isLoading) {
    return <Box sx={{ display: "grid", placeItems: "center", height: 200 }}><CircularProgress /></Box>;
  }

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Typography variant="h5">Projetos Internos</Typography>
        {can("projetos:projeto:criar") && (
          <Button startIcon={<AddIcon />} variant="contained" onClick={() => setDialogOpen(true)}>
            Novo projeto
          </Button>
        )}
      </Stack>

      <TableContainer component={Paper} variant="outlined">
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Nome</TableCell>
              <TableCell>Descrição</TableCell>
              <TableCell>Status</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {(projects ?? []).map((p) => (
              <TableRow key={p.id} hover sx={{ cursor: "pointer" }} onClick={() => navigate(`/projetos/${p.id}`)}>
                <TableCell>{p.name}</TableCell>
                <TableCell>{p.description ?? "—"}</TableCell>
                <TableCell>
                  <Chip size="small" label={p.status === "ativo" ? "Ativo" : "Arquivado"} color={p.status === "ativo" ? "success" : "default"} />
                </TableCell>
              </TableRow>
            ))}
            {(projects ?? []).length === 0 && (
              <TableRow><TableCell colSpan={3}><Typography color="text.secondary">Nenhum projeto. Crie o primeiro.</Typography></TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <NewProjectDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </Box>
  );
}

/** Diálogo de criação de projeto. */
function NewProjectDialog({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element {
  const create = useCreateProject();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [detail, setDetail] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit(): Promise<void> {
    setError(null);
    if (!name.trim()) {
      setError("Informe o nome do projeto.");
      return;
    }
    try {
      await create.mutateAsync({
        name: name.trim(),
        description: description.trim() || undefined,
        detail: detail.trim() || undefined,
      });
      setName(""); setDescription(""); setDetail("");
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Falha ao criar projeto.");
    }
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Novo projeto</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField label="Nome" value={name} onChange={(e) => setName(e.target.value)} required />
          <TextField label="Descrição curta" value={description} onChange={(e) => setDescription(e.target.value)} />
          <TextField label="Descritivo principal" value={detail} onChange={(e) => setDetail(e.target.value)} multiline minRows={4} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancelar</Button>
        <Button variant="contained" onClick={submit} disabled={create.isPending}>Criar</Button>
      </DialogActions>
    </Dialog>
  );
}
