#!/usr/bin/env bash
#
# HUB Central — redefine (ou cria) o SuperAdministrador.
#
# Uso (no servidor, como root):
#   sudo /opt/hubcentral/scripts/reset-admin.sh <email> <senha> [nome]
#
# Idempotente: se o e-mail já existe, redefine a senha e garante papel
# superadmin + todas as permissões; se não existe, cria. A senha fica com
# password_set=true (login direto, sem tela de troca).
#
# Variável opcional:
#   INSTALL_DIR  Diretório de instalação (default: /opt/hubcentral).

set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/hubcentral}"

log()  { printf '\033[1;34m[hubcentral]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[hubcentral][erro]\033[0m %s\n' "$*" >&2; exit 1; }

EMAIL="${1:-}"
PASSWORD="${2:-}"
NAME="${3:-Super Administrador}"

if [ -z "$EMAIL" ] || [ -z "$PASSWORD" ]; then
  die "Uso: sudo $0 <email> <senha> [nome]"
fi
if [ ! -f "$INSTALL_DIR/.env" ]; then
  die ".env não encontrado em $INSTALL_DIR. A instalação está nesse diretório?"
fi
if [ ! -f "$INSTALL_DIR/dist/cli/create-admin.js" ]; then
  die "CLI não compilado ($INSTALL_DIR/dist/cli/create-admin.js). Rode o instalador primeiro."
fi

log "Redefinindo SuperAdministrador: $EMAIL"
# Carrega DATABASE_URL do .env e executa o CLI idempotente.
( cd "$INSTALL_DIR" && set -a && . ./.env && set +a && node dist/cli/create-admin.js "$EMAIL" "$PASSWORD" "$NAME" )
log "Concluído. Faça login no portal com o e-mail e a nova senha."
