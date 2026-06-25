#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/opt/consultapp/consult-web-app}"
ENV_FILE="${ENV_FILE:-$APP_DIR/.env}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/consultapp}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
LOG_FILE="${LOG_FILE:-/var/log/consultapp-backup.log}"

timestamp="$(date +%Y%m%d-%H%M%S)"
db_dir="$BACKUP_DIR/db"
config_dir="$BACKUP_DIR/config"
files_dir="$BACKUP_DIR/files"

log() {
  printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" | tee -a "$LOG_FILE"
}

fail() {
  log "ERRO: $*"
  exit 1
}

trap 'log "ERRO: backup interrompido na linha $LINENO. Consulte as linhas anteriores do log."' ERR

if [[ ! -f "$ENV_FILE" ]]; then
  fail "Arquivo .env nao encontrado em $ENV_FILE"
fi

env_value() {
  local key="$1"
  awk -v key="$key" '
    $0 ~ "^[[:space:]]*" key "=" {
      sub("^[[:space:]]*" key "=", "")
      gsub(/^[[:space:]]+|[[:space:]]+$/, "")
      gsub(/^"|"$/, "")
      gsub(/^'\''|'\''$/, "")
      print
      exit
    }
  ' "$ENV_FILE"
}

DB_NAME="${DB_NAME:-$(env_value DB_NAME)}"
DB_USER="${DB_USER:-$(env_value DB_USER)}"
DB_PASSWORD="${DB_PASSWORD:-$(env_value DB_PASSWORD)}"
DB_HOST="${DB_HOST:-$(env_value DB_HOST)}"
DB_PORT="${DB_PORT:-$(env_value DB_PORT)}"

DB_NAME="${DB_NAME:-consultappdb}"
DB_USER="${DB_USER:-consultapp}"
DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-5432}"

if [[ -z "${DB_PASSWORD:-}" ]]; then
  fail "DB_PASSWORD nao configurado no .env"
fi

R2_ENABLED="${R2_ENABLED:-$(env_value R2_ENABLED)}"
R2_ACCOUNT_ID="${R2_ACCOUNT_ID:-$(env_value R2_ACCOUNT_ID)}"
R2_BUCKET="${R2_BUCKET:-$(env_value R2_BUCKET)}"
R2_ACCESS_KEY_ID="${R2_ACCESS_KEY_ID:-$(env_value R2_ACCESS_KEY_ID)}"
R2_SECRET_ACCESS_KEY="${R2_SECRET_ACCESS_KEY:-$(env_value R2_SECRET_ACCESS_KEY)}"
R2_ENDPOINT="${R2_ENDPOINT:-$(env_value R2_ENDPOINT)}"
R2_PREFIX="${R2_PREFIX:-$(env_value R2_PREFIX)}"

R2_PREFIX="${R2_PREFIX:-consultapp}"
R2_PREFIX="${R2_PREFIX#/}"
R2_PREFIX="${R2_PREFIX%/}"

R2_ENABLED="$(printf '%s' "$R2_ENABLED" | tr '[:upper:]' '[:lower:]')"
case "$R2_ENABLED" in
  true|1|yes|sim) R2_ENABLED="true" ;;
  *) R2_ENABLED="false" ;;
esac

if [[ "$R2_ENABLED" == "true" ]]; then
  [[ -n "$R2_BUCKET" ]] || fail "R2_BUCKET nao configurado no .env"
  [[ -n "$R2_ACCESS_KEY_ID" ]] || fail "R2_ACCESS_KEY_ID nao configurado no .env"
  [[ -n "$R2_SECRET_ACCESS_KEY" ]] || fail "R2_SECRET_ACCESS_KEY nao configurado no .env"
  [[ -n "$R2_ENDPOINT" || -n "$R2_ACCOUNT_ID" ]] || fail "Configure R2_ACCOUNT_ID ou R2_ENDPOINT no .env"
  R2_ENDPOINT="${R2_ENDPOINT:-https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com}"
fi

command -v pg_dump >/dev/null 2>&1 || fail "pg_dump nao encontrado"
command -v pg_restore >/dev/null 2>&1 || fail "pg_restore nao encontrado"
command -v tar >/dev/null 2>&1 || fail "tar nao encontrado"
if [[ "$R2_ENABLED" == "true" ]]; then
  command -v aws >/dev/null 2>&1 || fail "awscli nao encontrado. Instale com: sudo apt install -y awscli"
fi

umask 077
mkdir -p "$db_dir" "$config_dir" "$files_dir"

db_file="$db_dir/consultapp-${DB_NAME}-${timestamp}.backup"
sha_file="$db_file.sha256"
config_file="$config_dir/consultapp-config-${timestamp}.tar.gz"
files_file="$files_dir/consultapp-files-${timestamp}.tar.gz"
upload_files=()
latest_uploads=()

r2_path() {
  local category="$1"
  local file="$2"
  local name
  name="$(basename "$file")"
  printf '%s/%s/%s' "$R2_PREFIX" "$category" "$name"
}

r2_latest_path() {
  local name="$1"
  printf '%s/latest/%s' "$R2_PREFIX" "$name"
}

register_upload() {
  local category="$1"
  local file="$2"
  local latest_name="${3:-}"
  [[ -f "$file" ]] || return 0
  upload_files+=("$file|$(r2_path "$category" "$file")")
  if [[ -n "$latest_name" ]]; then
    latest_uploads+=("$file|$(r2_latest_path "$latest_name")")
  fi
}

upload_to_r2() {
  [[ "$R2_ENABLED" == "true" ]] || return 0
  local file="$1"
  local key="$2"
  log "Enviando para R2: s3://$R2_BUCKET/$key"
  AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" \
  AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
  AWS_DEFAULT_REGION="auto" \
    aws s3 cp "$file" "s3://$R2_BUCKET/$key" \
      --endpoint-url "$R2_ENDPOINT" \
      --only-show-errors >> "$LOG_FILE" 2>&1
}

log "Iniciando backup do ConsultApp"
log "Destino: $BACKUP_DIR"
if [[ "$R2_ENABLED" == "true" ]]; then
  log "Destino R2: s3://$R2_BUCKET/$R2_PREFIX"
else
  log "Backup externo R2 desativado. O backup ficara apenas na VPS."
fi

log "Gerando backup PostgreSQL: $db_file"
PGPASSWORD="$DB_PASSWORD" pg_dump \
  -h "$DB_HOST" \
  -p "$DB_PORT" \
  -U "$DB_USER" \
  -d "$DB_NAME" \
  -Fc \
  --no-owner \
  --no-privileges \
  -f "$db_file"

pg_restore -l "$db_file" >/dev/null
sha256sum "$db_file" > "$sha_file"
ln -sfn "$db_file" "$BACKUP_DIR/latest-db.backup"
register_upload "db" "$db_file" "latest-db.backup"
register_upload "db" "$sha_file" "latest-db.backup.sha256"
log "Backup PostgreSQL concluido: $(du -h "$db_file" | awk '{print $1}')"

config_paths=()
[[ -f "$APP_DIR/.env" ]] && config_paths+=("$APP_DIR/.env")
[[ -f "$APP_DIR/smtp-config.json" ]] && config_paths+=("$APP_DIR/smtp-config.json")
[[ -f "/etc/systemd/system/consultapp.service" ]] && config_paths+=("/etc/systemd/system/consultapp.service")
[[ -f "/etc/nginx/sites-available/consultapp" ]] && config_paths+=("/etc/nginx/sites-available/consultapp")

if (( ${#config_paths[@]} > 0 )); then
  log "Gerando backup de configuracoes sensiveis"
  tar -czf "$config_file" "${config_paths[@]}"
  sha256sum "$config_file" > "$config_file.sha256"
  ln -sfn "$config_file" "$BACKUP_DIR/latest-config.tar.gz"
  register_upload "config" "$config_file" "latest-config.tar.gz"
  register_upload "config" "$config_file.sha256" "latest-config.tar.gz.sha256"
else
  log "Nenhuma configuracao sensivel encontrada para empacotar"
fi

file_paths=()
[[ -d "$APP_DIR/Orcamentos" ]] && file_paths+=("$APP_DIR/Orcamentos")
[[ -d "$APP_DIR/Relatorios" ]] && file_paths+=("$APP_DIR/Relatorios")

if (( ${#file_paths[@]} > 0 )); then
  log "Gerando backup de arquivos locais"
  tar -czf "$files_file" "${file_paths[@]}"
  sha256sum "$files_file" > "$files_file.sha256"
  ln -sfn "$files_file" "$BACKUP_DIR/latest-files.tar.gz"
  register_upload "files" "$files_file" "latest-files.tar.gz"
  register_upload "files" "$files_file.sha256" "latest-files.tar.gz.sha256"
fi

if [[ "$R2_ENABLED" == "true" ]]; then
  log "Iniciando envio dos backups para Cloudflare R2"
  for item in "${upload_files[@]}" "${latest_uploads[@]}"; do
    upload_to_r2 "${item%%|*}" "${item#*|}"
  done
  log "Envio para R2 concluido"
fi

log "Aplicando retencao de $RETENTION_DAYS dias"
find "$BACKUP_DIR" -type f -mtime +"$RETENTION_DAYS" \
  \( -name 'consultapp-*.backup' -o -name 'consultapp-*.backup.sha256' -o -name 'consultapp-config-*.tar.gz' -o -name 'consultapp-config-*.tar.gz.sha256' -o -name 'consultapp-files-*.tar.gz' -o -name 'consultapp-files-*.tar.gz.sha256' \) \
  -delete

log "Backup finalizado com sucesso"
