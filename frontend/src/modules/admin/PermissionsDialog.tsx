/**
 * @file PermissionsDialog.tsx
 * @module modules/admin
 *
 * Editor de permissões RBAC de um usuário. Lista o catálogo de namespaces
 * agrupado pelo módulo (primeiro segmento) com checkboxes, e salva o conjunto.
 */

import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, FormControlLabel, Checkbox,
  Typography, Box, CircularProgress, Divider,
} from "@mui/material";
import { listNamespaces, getUserPermissions, setUserPermissions, type AdminUser } from "../../core/api/iam.js";

/**
 * Diálogo de edição de permissões de um usuário.
 *
 * @param props.user - Usuário alvo.
 * @param props.onClose - Callback de fechamento.
 * @returns O diálogo de permissões.
 */
export function PermissionsDialog({ user, onClose }: { user: AdminUser; onClose: () => void }): JSX.Element {
  const qc = useQueryClient();
  const catalog = useQuery({ queryKey: ["iam", "namespaces"], queryFn: listNamespaces });
  const current = useQuery({ queryKey: ["iam", "perms", user.id], queryFn: () => getUserPermissions(user.id) });

  // Estado local do conjunto selecionado (inicia com o atual quando carregado).
  const selected = useMemo(() => new Set(current.data ?? []), [current.data]);

  const save = useMutation({
    mutationFn: (namespaces: string[]) => setUserPermissions(user.id, namespaces),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["iam", "perms", user.id] });
      onClose();
    },
  });

  // Agrupa por módulo (primeiro segmento do namespace).
  const grouped = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const ns of catalog.data ?? []) {
      const mod = ns.split(":")[0] ?? "outros";
      if (!map.has(mod)) map.set(mod, []);
      map.get(mod)!.push(ns);
    }
    return map;
  }, [catalog.data]);

  function toggle(ns: string): void {
    if (selected.has(ns)) selected.delete(ns);
    else selected.add(ns);
    // Força re-render mutando via novo set no cache local.
    qc.setQueryData(["iam", "perms", user.id], Array.from(selected));
  }

  const loading = catalog.isLoading || current.isLoading;

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>Permissões — {user.email}</DialogTitle>
      <DialogContent dividers>
        {loading ? (
          <Box sx={{ display: "grid", placeItems: "center", height: 160 }}><CircularProgress /></Box>
        ) : (
          Array.from(grouped.entries()).map(([mod, namespaces]) => (
            <Box key={mod} sx={{ mb: 2 }}>
              <Typography variant="subtitle2" sx={{ textTransform: "uppercase" }} color="text.secondary">{mod}</Typography>
              <Divider sx={{ mb: 1 }} />
              <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
                {namespaces.map((ns) => (
                  <FormControlLabel
                    key={ns}
                    control={<Checkbox size="small" checked={selected.has(ns)} onChange={() => toggle(ns)} />}
                    label={<Typography variant="body2">{ns}</Typography>}
                  />
                ))}
              </Box>
            </Box>
          ))
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancelar</Button>
        <Button variant="contained" onClick={() => save.mutate(Array.from(selected))} disabled={save.isPending}>
          {save.isPending ? "Salvando..." : "Salvar"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
