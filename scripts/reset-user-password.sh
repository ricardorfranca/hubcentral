#!/usr/bin/env bash
#
# HUB Central — redefine a senha de um usuário existente.
#
# Uso (no servidor, como root):
#   sudo /opt/hubcentral/scripts/reset-user-password.sh <email> <senha>
#
# Define diretamente a senha final do usuário (password_set=true, login direto
# sem tela de troca), SEM alterar papel, status ou permissões. O usuário precisa
# já existir; a senha deve ter no mínimo 6 caracteres.
#
# Variável opcional:
#   INSTALL_DIR  Diretório de instalação (default: /opt/hubcentral).

set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/hubcentral}"

log()  { printf '\033[1;34m[hubcentral]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[hubcentral][erro]\033[0m %s\n' "$*" >&2; exit 1; }

EMAIL="${1:-}"
PASSWORD="${2:-}"

if [ -z "$EMAIL" ] || [ -z "$PASSWORD" ]; then
  die "Uso: sudo $0 <email> <senha>"
fi
if [ ${#PASSWORD} -lt 6 ]; then
  die "A senha deve ter ao menos 6 caracteres."
fi
if [ ! -f "$INSTALL_DIR/.env" ]; then
  die ".env não encontrado em $INSTALL_DIR. A instalação está nesse diretório?"
fi
if [ ! -f "$INSTALL_DIR/dist/core/iam/identity-service.js" ]; then
  die "Backend não compilado ($INSTALL_DIR/dist/). Rode o instalador/build primeiro."
fi

log "Redefinindo a senha de: $EMAIL"
# Carrega DATABASE_URL do .env e redefine a senha reaproveitando a lógica do
# backend (hash scrypt + validação). O e-mail e a senha são passados como
# argumentos (não interpolados no script) para evitar problemas de escaping.
( cd "$INSTALL_DIR" && set -a && . ./.env && set +a && \
  node --input-type=module -e '
import { createPool, withTransaction } from "./dist/core/db/pool.js";
import { setPassword } from "./dist/core/iam/identity-service.js";
const [email, senha] = process.argv.slice(1);
const pool = createPool();
try {
  await withTransaction(pool, async (c) => {
    const { rows } = await c.query("SELECT id FROM core.users WHERE email = $1", [email]);
    if (!rows[0]) throw new Error("Usuário não encontrado: " + email);
    await setPassword(c, rows[0].id, senha);
  });
} finally {
  await pool.end();
}
' "$EMAIL" "$PASSWORD" )

log "Concluído. O usuário já pode entrar no portal com a nova senha."
