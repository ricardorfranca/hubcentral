#!/usr/bin/env bash
#
# HUB Central — instalador/atualizador para Linux (foco Debian/Ubuntu).
#
# Uso rápido (instala ou atualiza):
#   curl -sSL https://raw.githubusercontent.com/ricardorfranca/hubcentral/main/scripts/install.sh | sudo sh
#
# O script é idempotente: numa primeira execução instala tudo; nas seguintes,
# atualiza o código, reconstrói, aplica migrations e reinicia o serviço,
# preservando o arquivo .env existente.
#
# Variáveis de ambiente opcionais:
#   DATABASE_URL   Se definida, o script NÃO instala PostgreSQL local e usa esta URL.
#   HUBCENTRAL_REF Branch/tag a instalar (default: main).
#   INSTALL_DIR    Diretório de instalação (default: /opt/hubcentral).

set -euo pipefail

# ----- Configuração -----
REPO_URL="https://github.com/ricardorfranca/hubcentral.git"
INSTALL_DIR="${INSTALL_DIR:-/opt/hubcentral}"
SERVICE_USER="hubcentral"
SERVICE_NAME="hubcentral"
NODE_MAJOR="20"
REF="${HUBCENTRAL_REF:-main}"

# ----- Utilidades de log -----
log()  { printf '\033[1;34m[hubcentral]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[hubcentral][aviso]\033[0m %s\n' "$*"; }
err()  { printf '\033[1;31m[hubcentral][erro]\033[0m %s\n' "$*" >&2; }
die()  { err "$*"; exit 1; }

# ----- Pré-condições -----

# Garante execução como root (necessário para apt, systemd e /opt).
require_root() {
  if [ "$(id -u)" -ne 0 ]; then
    die "Este instalador precisa ser executado como root. Use: curl -sSL <url> | sudo sh"
  fi
}

# Detecta o gerenciador de pacotes. Foco em apt (Debian/Ubuntu); avisa em outros.
detect_pkg_manager() {
  if command -v apt-get >/dev/null 2>&1; then
    PKG="apt"
  elif command -v dnf >/dev/null 2>&1; then
    PKG="dnf"
  elif command -v yum >/dev/null 2>&1; then
    PKG="yum"
  else
    die "Gerenciador de pacotes não suportado. Este script requer apt (Debian/Ubuntu), dnf ou yum."
  fi
  log "Gerenciador de pacotes detectado: $PKG"
}

# ----- Instalação de dependências -----

# Instala pacotes base: git, curl, ca-certificates, build tools.
install_base_packages() {
  log "Instalando pacotes base (git, curl, build tools)..."
  case "$PKG" in
    apt)
      export DEBIAN_FRONTEND=noninteractive
      apt-get update -qq
      apt-get install -y -qq git curl ca-certificates gnupg build-essential
      ;;
    dnf)
      dnf install -y -q git curl ca-certificates gcc-c++ make
      ;;
    yum)
      yum install -y -q git curl ca-certificates gcc-c++ make
      ;;
  esac
}

# Instala Node.js 20 LTS se ausente ou versão inferior.
install_node() {
  if command -v node >/dev/null 2>&1; then
    local current
    current="$(node -v | sed 's/^v//' | cut -d. -f1)"
    if [ "$current" -ge "$NODE_MAJOR" ]; then
      log "Node.js $(node -v) já instalado."
      return
    fi
    warn "Node.js $(node -v) é inferior ao exigido (>=${NODE_MAJOR}); atualizando."
  fi
  log "Instalando Node.js ${NODE_MAJOR} LTS..."
  case "$PKG" in
    apt)
      curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
      apt-get install -y -qq nodejs
      ;;
    dnf|yum)
      curl -fsSL "https://rpm.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
      "$PKG" install -y -q nodejs
      ;;
  esac
  log "Node.js $(node -v) instalado."
}

# Instala e inicia o PostgreSQL local (apenas se DATABASE_URL não foi fornecida).
install_postgres() {
  if command -v psql >/dev/null 2>&1 && systemctl list-unit-files 2>/dev/null | grep -q postgresql; then
    log "PostgreSQL já instalado."
  else
    log "Instalando PostgreSQL..."
    case "$PKG" in
      apt) apt-get install -y -qq postgresql postgresql-contrib ;;
      dnf) dnf install -y -q postgresql-server postgresql-contrib && postgresql-setup --initdb || true ;;
      yum) yum install -y -q postgresql-server postgresql-contrib && postgresql-setup initdb || true ;;
    esac
  fi
  systemctl enable --now postgresql >/dev/null 2>&1 || systemctl start postgresql || true
}

# Executa psql como o usuário do sistema 'postgres', de forma robusta em
# ambientes enxutos (usa runuser; cai para su se necessário).
psql_as_postgres() {
  if command -v runuser >/dev/null 2>&1; then
    runuser -u postgres -- psql "$@"
  else
    su -s /bin/sh postgres -c "psql $(printf '%q ' "$@")"
  fi
}

# Cria o banco e o usuário local, retornando a DATABASE_URL em DB_URL_LOCAL.
# Idempotente: não recria se já existir; reaproveita a senha do .env se houver.
provision_local_db() {
  local db_name="hub_central" db_user="hubcentral" db_pass
  # Se um .env já existe com DATABASE_URL, reutiliza (preserva a senha).
  if [ -f "$INSTALL_DIR/.env" ] && grep -q '^DATABASE_URL=' "$INSTALL_DIR/.env"; then
    DB_URL_LOCAL="$(grep '^DATABASE_URL=' "$INSTALL_DIR/.env" | head -1 | cut -d= -f2-)"
    log "Reutilizando DATABASE_URL existente do .env."
    return
  fi
  db_pass="$(head -c 18 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9' | head -c 24)"

  # Cria o role se não existir.
  psql_as_postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname='${db_user}'" | grep -q 1 || \
    psql_as_postgres -q -c "CREATE ROLE ${db_user} LOGIN PASSWORD '${db_pass}';"
  # Cria o banco se não existir.
  psql_as_postgres -tAc "SELECT 1 FROM pg_database WHERE datname='${db_name}'" | grep -q 1 || \
    psql_as_postgres -q -c "CREATE DATABASE ${db_name} OWNER ${db_user};"

  DB_URL_LOCAL="postgres://${db_user}:${db_pass}@localhost:5432/${db_name}"
  log "Banco local ${db_name} provisionado."
}

# ----- Usuário de sistema -----

create_service_user() {
  if id "$SERVICE_USER" >/dev/null 2>&1; then
    log "Usuário de sistema '$SERVICE_USER' já existe."
  else
    log "Criando usuário de sistema '$SERVICE_USER'..."
    useradd --system --home "$INSTALL_DIR" --shell /usr/sbin/nologin "$SERVICE_USER" 2>/dev/null || \
      useradd --system --home "$INSTALL_DIR" --shell /bin/false "$SERVICE_USER"
  fi
}

# ----- Código: clonar ou atualizar -----

fetch_code() {
  if [ -d "$INSTALL_DIR/.git" ]; then
    log "Atualizando código existente em $INSTALL_DIR (ref: $REF)..."
    git -C "$INSTALL_DIR" fetch --quiet --all --tags
    git -C "$INSTALL_DIR" checkout --quiet "$REF"
    git -C "$INSTALL_DIR" pull --quiet --ff-only origin "$REF" || true
  else
    log "Clonando o repositório em $INSTALL_DIR (ref: $REF)..."
    mkdir -p "$INSTALL_DIR"
    git clone --quiet --branch "$REF" "$REPO_URL" "$INSTALL_DIR"
  fi
}

# ----- .env: gerar na primeira vez, preservar nas atualizações -----

ensure_env() {
  local env_file="$INSTALL_DIR/.env"
  if [ -f "$env_file" ]; then
    log "Arquivo .env existente preservado."
    return
  fi
  local db_url
  if [ -n "${DATABASE_URL:-}" ]; then
    db_url="$DATABASE_URL"
    log "Usando DATABASE_URL fornecida via ambiente."
  else
    db_url="$DB_URL_LOCAL"
  fi
  log "Gerando .env inicial..."
  cat > "$env_file" <<EOF
# Gerado pelo instalador do HUB Central em $(date -u +%Y-%m-%dT%H:%M:%SZ)
DATABASE_URL=${db_url}
PORT=3000
EOF
  chmod 600 "$env_file"
}

# ----- Build e migrations -----

build_app() {
  log "Instalando dependências (npm ci)..."
  ( cd "$INSTALL_DIR" && npm ci --no-audit --no-fund )
  log "Compilando (npm run build)..."
  ( cd "$INSTALL_DIR" && npm run build )
}

run_migrations() {
  log "Aplicando migrations..."
  # Carrega DATABASE_URL do .env para o node-pg-migrate.
  ( cd "$INSTALL_DIR" && set -a && . ./.env && set +a && npx --yes node-pg-migrate up --no-check-order )
}

set_ownership() {
  chown -R "$SERVICE_USER":"$SERVICE_USER" "$INSTALL_DIR"
}

# ----- Serviço systemd -----

install_service() {
  if ! command -v systemctl >/dev/null 2>&1; then
    warn "systemd não encontrado; pulando criação do serviço. Rode manualmente: (cd $INSTALL_DIR && node dist/server.js)"
    return
  fi
  log "Instalando serviço systemd '$SERVICE_NAME'..."
  local node_bin
  node_bin="$(command -v node)"
  cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<EOF
[Unit]
Description=HUB Central (API + worker de eventos)
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=simple
User=${SERVICE_USER}
WorkingDirectory=${INSTALL_DIR}
EnvironmentFile=${INSTALL_DIR}/.env
ExecStart=${node_bin} ${INSTALL_DIR}/dist/server.js
Restart=always
RestartSec=5
NoNewPrivileges=true
ProtectSystem=full
ProtectHome=true

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable "$SERVICE_NAME" >/dev/null 2>&1 || true
  systemctl restart "$SERVICE_NAME"
  log "Serviço '$SERVICE_NAME' (re)iniciado."
}

# ----- Fluxo principal -----

main() {
  require_root
  detect_pkg_manager
  install_base_packages
  install_node

  if [ -z "${DATABASE_URL:-}" ]; then
    install_postgres
    provision_local_db
  else
    log "DATABASE_URL fornecida; PostgreSQL local não será instalado."
  fi

  create_service_user
  fetch_code
  ensure_env
  build_app
  run_migrations
  set_ownership
  install_service

  log "Concluído. HUB Central instalado/atualizado em $INSTALL_DIR."
  if command -v systemctl >/dev/null 2>&1; then
    log "Status:   systemctl status ${SERVICE_NAME}"
    log "Logs:     journalctl -u ${SERVICE_NAME} -f"
  fi
}

main "$@"
