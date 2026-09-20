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
REPO_SLUG="ricardorfranca/hubcentral"
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
  # O repositório pertence ao usuário 'hubcentral', mas o instalador roda como
  # root. O Git recusa operar em repos de outro dono (CVE-2022-24765); marca-se
  # o diretório como seguro para o root, de forma idempotente (sem duplicar).
  if ! git config --global --get-all safe.directory 2>/dev/null | grep -qx "$INSTALL_DIR"; then
    git config --global --add safe.directory "$INSTALL_DIR" 2>/dev/null || true
  fi

  if [ -d "$INSTALL_DIR/.git" ]; then
    log "Atualizando código existente em $INSTALL_DIR (ref: $REF)..."
    # Sincronização determinística com a origem: nunca depende de fast-forward
    # nem do estado local (o diretório de deploy não deve ter alterações
    # manuais). Se qualquer passo falhar, cai para re-clonagem limpa.
    if git -C "$INSTALL_DIR" fetch --quiet --all --tags \
       && git -C "$INSTALL_DIR" reset --hard --quiet "origin/${REF}" 2>/dev/null; then
      : # atualizado com sucesso
    elif git -C "$INSTALL_DIR" reset --hard --quiet "$REF" 2>/dev/null; then
      : # ref é uma tag (não tem origin/<tag>); resetou para a tag
    else
      warn "Não foi possível atualizar o repositório existente; re-clonando limpo."
      reclone_repo
    fi
  else
    log "Clonando o repositório em $INSTALL_DIR (ref: $REF)..."
    mkdir -p "$INSTALL_DIR"
    git clone --quiet --branch "$REF" "$REPO_URL" "$INSTALL_DIR"
  fi
}

# Re-clona o repositório preservando o .env existente (deploy corrompido/divergido).
reclone_repo() {
  local backup=""
  if [ -f "$INSTALL_DIR/.env" ]; then
    backup="$(mktemp)"
    cp "$INSTALL_DIR/.env" "$backup"
  fi
  rm -rf "$INSTALL_DIR"
  git clone --quiet --branch "$REF" "$REPO_URL" "$INSTALL_DIR"
  if [ -n "$backup" ]; then
    cp "$backup" "$INSTALL_DIR/.env"
    rm -f "$backup"
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
# Anexos do módulo de Projetos Internos (armazenamento em disco local).
# Os limites efetivos (tamanho/tipos) são configuráveis na Central de
# Configurações do portal; estas variáveis são apenas o fallback inicial.
UPLOADS_DIR=${INSTALL_DIR}/uploads
UPLOADS_MAX_BYTES=26214400
UPLOADS_ALLOWED=pdf,png,jpg,jpeg,gif,webp,txt,doc,docx,xls,xlsx,ppt,pptx,zip
EOF
  chmod 600 "$env_file"
}

# Cria o diretório de uploads (anexos de tarefas) se ainda não existir. O
# caminho vem do .env (UPLOADS_DIR) ou usa o default sob o diretório de
# instalação. Incluído no backup do servidor.
ensure_uploads_dir() {
  local uploads_dir="$INSTALL_DIR/uploads"
  if [ -f "$INSTALL_DIR/.env" ] && grep -q '^UPLOADS_DIR=' "$INSTALL_DIR/.env"; then
    uploads_dir="$(grep '^UPLOADS_DIR=' "$INSTALL_DIR/.env" | head -1 | cut -d= -f2-)"
  fi
  log "Garantindo diretório de uploads em ${uploads_dir}..."
  mkdir -p "$uploads_dir"
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

# ----- Frontend + nginx -----

# Compila o frontend localmente (fallback). Pesado; pode exceder a memória de
# VMs pequenas — por isso o caminho preferido é baixar o artefato pré-compilado.
build_frontend_local() {
  log "Compilando o frontend localmente (fallback)..."
  ( cd "$INSTALL_DIR/frontend" && npm ci --no-audit --no-fund && npm run build )
}

# Obtém o frontend/dist. Preferência: baixar o artefato pré-compilado
# (frontend-dist.tar.gz) anexado à release da tag, evitando compilar no
# servidor (ideal para VMs pequenas). Se não houver artefato (ex.: REF é um
# branch), cai para o build local.
fetch_frontend() {
  if [ ! -d "$INSTALL_DIR/frontend" ]; then
    warn "Diretório frontend/ ausente; pulando frontend."
    return
  fi

  # Descobre a tag da release: usa a versão do package.json (v<versão>).
  local version tag tarball url
  version="$(node -p "require('$INSTALL_DIR/package.json').version" 2>/dev/null || echo "")"
  tag="v${version}"
  tarball="$(mktemp --suffix=.tar.gz)"
  url="https://github.com/${REPO_SLUG}/releases/download/${tag}/frontend-dist.tar.gz"

  if [ -n "$version" ] && curl -fsSL "$url" -o "$tarball" 2>/dev/null; then
    log "Baixando frontend pré-compilado da release ${tag}..."
    rm -rf "$INSTALL_DIR/frontend/dist"
    if tar -xzf "$tarball" -C "$INSTALL_DIR/frontend" 2>/dev/null && [ -d "$INSTALL_DIR/frontend/dist" ]; then
      rm -f "$tarball"
      log "Frontend pré-compilado instalado."
      return
    fi
    warn "Falha ao extrair o artefato; tentando build local."
  else
    warn "Artefato pré-compilado indisponível para ${tag}; compilando localmente."
  fi
  rm -f "$tarball"
  build_frontend_local
}

# Instala e configura o nginx para servir a SPA e fazer proxy de /api.
install_nginx() {
  if [ ! -d "$INSTALL_DIR/frontend/dist" ]; then
    warn "frontend/dist ausente; nginx não será configurado."
    return
  fi
  log "Instalando e configurando nginx..."
  case "$PKG" in
    apt) apt-get install -y -qq nginx ;;
    dnf) dnf install -y -q nginx ;;
    yum) yum install -y -q nginx ;;
  esac

  local conf_src="$INSTALL_DIR/deploy/nginx/hubcentral.conf"
  if [ -d /etc/nginx/sites-available ]; then
    # Debian/Ubuntu: sites-available + symlink em sites-enabled.
    cp "$conf_src" /etc/nginx/sites-available/hubcentral
    ln -sf /etc/nginx/sites-available/hubcentral /etc/nginx/sites-enabled/hubcentral
    rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true
  else
    # RHEL/derivados: conf.d.
    cp "$conf_src" /etc/nginx/conf.d/hubcentral.conf
  fi

  # Valida a config antes de recarregar; não derruba o serviço se falhar.
  if nginx -t 2>/dev/null; then
    systemctl enable --now nginx >/dev/null 2>&1 || systemctl restart nginx || true
    systemctl reload nginx 2>/dev/null || systemctl restart nginx || true
    log "nginx configurado e recarregado."
  else
    err "Configuração do nginx inválida; verifique com 'nginx -t'."
  fi
}

# ----- Bootstrap do SuperAdministrador -----

# Cria o primeiro SuperAdministrador, apenas se ainda não existir nenhum.
# Idempotente: em atualizações, não recria nem altera credenciais.
# Credenciais: usa HUBCENTRAL_ADMIN_EMAIL/PASSWORD do ambiente; se ausentes,
# gera uma senha aleatória e a exibe uma única vez.
bootstrap_admin() {
  # Verifica se já existe um superadmin (ignora falha silenciosamente).
  local existing
  existing="$(
    cd "$INSTALL_DIR" && set -a && . ./.env && set +a && \
    node -e "import('pg').then(async ({default:{Pool}})=>{const p=new Pool({connectionString:process.env.DATABASE_URL});try{const r=await p.query(\"SELECT 1 FROM core.users WHERE role='superadmin' LIMIT 1\");process.stdout.write(String(r.rowCount));}catch(e){process.stdout.write('err');}finally{await p.end();}})" 2>/dev/null || echo "err"
  )"

  if [ "$existing" = "1" ]; then
    log "SuperAdministrador já existe; bootstrap ignorado."
    return
  fi
  if [ "$existing" = "err" ]; then
    warn "Não foi possível verificar o SuperAdministrador; pulando bootstrap. Rode manualmente: (cd $INSTALL_DIR && npm run create-admin -- <email> <senha>)"
    return
  fi

  local admin_email admin_pass generated=0
  admin_email="${HUBCENTRAL_ADMIN_EMAIL:-admin@hubcentral.local}"
  if [ -n "${HUBCENTRAL_ADMIN_PASSWORD:-}" ]; then
    admin_pass="$HUBCENTRAL_ADMIN_PASSWORD"
  else
    admin_pass="$(head -c 18 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9' | head -c 16)"
    generated=1
  fi

  log "Criando SuperAdministrador inicial ($admin_email)..."
  ( cd "$INSTALL_DIR" && set -a && . ./.env && set +a && \
    node dist/cli/create-admin.js "$admin_email" "$admin_pass" "Super Administrador" )

  if [ "$generated" -eq 1 ]; then
    printf '\033[1;32m[hubcentral]\033[0m ================ CREDENCIAIS DO SUPERADMIN ================\n'
    printf '\033[1;32m[hubcentral]\033[0m  E-mail: %s\n' "$admin_email"
    printf '\033[1;32m[hubcentral]\033[0m  Senha : %s\n' "$admin_pass"
    printf '\033[1;32m[hubcentral]\033[0m  Guarde agora: esta senha NÃO será exibida novamente.\n'
    printf '\033[1;32m[hubcentral]\033[0m ==========================================================\n'
  fi
}

# ----- Swap temporário (VMs pequenas) -----

SWAP_FILE="/swapfile.hubcentral"
SWAP_ADDED=0

# Ativa um swap temporário se a RAM for pequena (< 2 GB) e não houver swap,
# evitando que o build do backend (tsc) seja morto por falta de memória (OOM).
ensure_swap() {
  local mem_kb swap_kb
  mem_kb="$(awk '/MemTotal/ {print $2}' /proc/meminfo 2>/dev/null || echo 0)"
  swap_kb="$(awk '/SwapTotal/ {print $2}' /proc/meminfo 2>/dev/null || echo 0)"
  # < ~2GB de RAM e sem swap ativo.
  if [ "$mem_kb" -lt 2000000 ] && [ "$swap_kb" -lt 262144 ] && [ ! -f "$SWAP_FILE" ]; then
    log "Memória baixa detectada; ativando swap temporário de 2G para o build..."
    if fallocate -l 2G "$SWAP_FILE" 2>/dev/null || dd if=/dev/zero of="$SWAP_FILE" bs=1M count=2048 2>/dev/null; then
      chmod 600 "$SWAP_FILE"
      mkswap "$SWAP_FILE" >/dev/null 2>&1 || true
      if swapon "$SWAP_FILE" 2>/dev/null; then
        SWAP_ADDED=1
      else
        rm -f "$SWAP_FILE"
      fi
    fi
  fi
}

# Desativa e remove o swap temporário criado por ensure_swap.
cleanup_swap() {
  if [ "$SWAP_ADDED" -eq 1 ]; then
    swapoff "$SWAP_FILE" 2>/dev/null || true
    rm -f "$SWAP_FILE"
    SWAP_ADDED=0
  fi
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
  ensure_uploads_dir

  ensure_swap
  # Garante a limpeza do swap mesmo se um passo abaixo falhar.
  trap cleanup_swap EXIT
  build_app
  fetch_frontend
  cleanup_swap
  trap - EXIT

  run_migrations
  bootstrap_admin
  set_ownership
  install_service
  install_nginx

  log "Concluído. HUB Central instalado/atualizado em $INSTALL_DIR."
  if command -v systemctl >/dev/null 2>&1; then
    log "Status:   systemctl status ${SERVICE_NAME}"
    log "Logs:     journalctl -u ${SERVICE_NAME} -f"
  fi
  if [ -d "$INSTALL_DIR/frontend/dist" ]; then
    log "Portal web disponível via nginx (porta 80). Configure o domínio e TLS conforme o README."
  fi
}

main "$@"
