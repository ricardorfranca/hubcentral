/**
 * @file PermissionsDialog.tsx
 * @module modules/admin
 *
 * Editor de permissões RBAC de um usuário. Lista o catálogo de namespaces
 * agrupado pelo módulo (primeiro segmento) com checkboxes, e salva o conjunto.
 * Cada categoria oferece atalhos para marcar/desmarcar todas as suas permissões
 * de uma vez, agilizando a atribuição.
 */

import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, FormControlLabel, Checkbox,
  Typography, Box, CircularProgress, Divider, Stack,
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

  // Estado local do conjunto selecionado. Inicia (e re-sincroniza) a partir das
  // permissões atuais quando a query de leitura carrega/muda.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (current.data) setSelected(new Set(current.data));
  }, [current.data]);

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
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(ns)) next.delete(ns);
      else next.add(ns);
      return next;
    });
  }

  /** Marca (add=true) ou desmarca (add=false) todas as permissões de uma categoria. */
  function setCategory(namespaces: readonly string[], add: boolean): void {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const ns of namespaces) {
        if (add) next.add(ns);
        else next.delete(ns);
      }
      return next;
    });
  }

  const loading = catalog.isLoading || current.isLoading;

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>Permissões — {user.email}</DialogTitle>
      <DialogContent dividers>
        {loading ? (
          <Box sx={{ display: "grid", placeItems: "center", height: 160 }}><CircularProgress /></Box>
        ) : (
          Array.from(grouped.entries()).map(([mod, namespaces]) => {
            const selectedCount = namespaces.filter((ns) => selected.has(ns)).length;
            const allSelected = selectedCount === namespaces.length;
            const noneSelected = selectedCount === 0;
            return (
              <Box key={mod} sx={{ mb: 2 }}>
                <Stack direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap" useFlexGap>
                  <Typography variant="subtitle2" sx={{ textTransform: "uppercase" }} color="text.secondary">
                    {mod} <Typography component="span" variant="caption" color="text.secondary">({selectedCount}/{namespaces.length})</Typography>
                  </Typography>
                  <Stack direction="row" spacing={1}>
                    <Button
                      size="small"
                      onClick={() => setCategory(namespaces, true)}
                      disabled={allSelected}
                    >
                      Marcar todas
                    </Button>
                    <Button
                      size="small"
                      color="inherit"
                      onClick={() => setCategory(namespaces, false)}
                      disabled={noneSelected}
                    >
                      Desmarcar todas
                    </Button>
                  </Stack>
                </Stack>
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
            );
          })
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
