#!/usr/bin/env bash
# Installs Feedway on a fresh host: secrets, configuration, Tailscale and the stack.
# Safe to run again: existing secrets and keys are never rewritten.
#
# Non-interactive mode (CI): INSTALL_NONINTERACTIVE=1 with INSTALL_TS_HOSTNAME,
# INSTALL_TS_AUTHKEY_FILE, INSTALL_OWNER_EMAIL and INSTALL_AGE_KEY_OUT (INSTALL_ORGANIZATION_NAME
# is optional). Also
# INSTALL_SKIP_TAILSCALE=1, INSTALL_IMAGE, INSTALL_IMAGE_TAG and INSTALL_SKIP_CHOWN=1 (tests only).
set -euo pipefail
umask 077

cd "$(dirname "${BASH_SOURCE[0]}")/.."
# shellcheck source=scripts/lib/common.sh
source scripts/lib/common.sh

noninteractive="${INSTALL_NONINTERACTIVE:-0}"
skip_tailscale="${INSTALL_SKIP_TAILSCALE:-0}"

# 1) prerequisites
require_docker
command -v openssl >/dev/null 2>&1 || die "Manca openssl."
command -v age-keygen >/dev/null 2>&1 || die "Manca age (pacchetto 'age'): serve per la chiave dei backup."

# 2) answers
ask() { # ask VAR "question" default
  local var="$1" question="$2" default="$3" answer
  if [ "$noninteractive" = "1" ]; then
    printf -v "$var" '%s' "$default"
    return
  fi
  read -r -p "$question [$default]: " answer
  printf -v "$var" '%s' "${answer:-$default}"
}

ts_hostname=""
owner_email=""
organization_name=""
ts_hostname_default="${INSTALL_TS_HOSTNAME:-$(env_get TS_HOSTNAME)}"
owner_default="${INSTALL_OWNER_EMAIL:-$(env_get BOOTSTRAP_OWNER_EMAIL)}"
ask ts_hostname "Nome host Tailscale" "${ts_hostname_default:-pannello}"
ask owner_email "Email dell'Owner" "$owner_default"
[ -n "$owner_email" ] || die "L'email dell'Owner è obbligatoria."
organization_default="${INSTALL_ORGANIZATION_NAME:-$(env_get BOOTSTRAP_ORGANIZATION_NAME)}"
ask organization_name "Nome della tua agenzia" "${organization_default:-La mia agenzia}"
organization_name="$(trim "$organization_name")"
check_organization_name "$organization_name"

# 3) secrets
mkdir -p secrets
chmod 700 secrets

base64url() { openssl rand -base64 32 | tr '+/' '-_' | tr -d '=\n'; }

write_secret() { # write_secret name value: never overwrites
  local file="secrets/$1"
  if [ -e "$file" ]; then
    return
  fi
  printf '%s' "$2" >"$file"
  chmod 600 "$file"
}

write_secret postgres_password "$(base64url)"
write_secret db_migrator_password "$(base64url)"
write_secret db_runtime_password "$(base64url)"
write_secret app_encryption_key "$(openssl rand -base64 32 | tr -d '\n')"
write_secret better_auth_secret "$(openssl rand -base64 32 | tr -d '\n')"
write_secret database_url "postgres://app_runtime:$(cat secrets/db_runtime_password)@postgres:5432/app"
write_secret database_migrator_url "postgres://app_migrator:$(cat secrets/db_migrator_password)@postgres:5432/app"

if [ -e secrets/ts_authkey ]; then
  :
elif [ "$skip_tailscale" = "1" ]; then
  write_secret ts_authkey "non-usata"
elif [ "$noninteractive" = "1" ]; then
  [ -r "${INSTALL_TS_AUTHKEY_FILE:-}" ] || die "Indica INSTALL_TS_AUTHKEY_FILE."
  write_secret ts_authkey "$(tr -d '\n' <"$INSTALL_TS_AUTHKEY_FILE")"
else
  read -r -s -p "Chiave di autenticazione Tailscale (non viene mostrata): " authkey
  printf '\n'
  [ -n "$authkey" ] || die "La chiave Tailscale è obbligatoria."
  write_secret ts_authkey "$authkey"
fi

# The containers run as other users and read the secrets through bind mounts.
chown_secrets() { # chown_secrets uid files...
  local owner="$1"
  shift
  local file
  for file in "$@"; do
    if [ "$(id -u)" -eq 0 ]; then
      chown "$owner:$owner" "secrets/$file"
    else
      sudo -n chown "$owner:$owner" "secrets/$file" 2>/dev/null ||
        warn "non riesco a dare 'secrets/$file' all'utente $owner: rilancia con sudo."
    fi
  done
}
if [ "${INSTALL_SKIP_CHOWN:-0}" != "1" ]; then
  chown_secrets 10001 database_url database_migrator_url app_encryption_key better_auth_secret
  chown_secrets 70 postgres_password db_migrator_password db_runtime_password
fi

# 4) backup key (age): the private half is shown once and never stored here
if [ -z "$(env_get BACKUP_AGE_RECIPIENT)" ]; then
  age_output="$(age-keygen 2>/dev/null)"
  recipient="$(printf '%s\n' "$age_output" | sed -n 's/^# public key: //p')"
  private_key="$(printf '%s\n' "$age_output" | grep '^AGE-SECRET-KEY-')"
  if [ -z "$recipient" ] || [ -z "$private_key" ]; then
    die "age-keygen non ha prodotto una chiave valida."
  fi
  if [ "$noninteractive" = "1" ]; then
    [ -n "${INSTALL_AGE_KEY_OUT:-}" ] || die "Indica INSTALL_AGE_KEY_OUT."
    printf '%s\n' "$private_key" >"$INSTALL_AGE_KEY_OUT"
    chmod 600 "$INSTALL_AGE_KEY_OUT"
  else
    log ""
    log "Chiave privata dei backup (serve per ripristinarli, non sarà mostrata di nuovo):"
    log "  $private_key"
    log "Salvala ora nel gestore di password."
    confirmation=""
    while [ "$confirmation" != "salvata" ]; do
      read -r -p "Scrivi 'salvata' quando l'hai fatto: " confirmation
    done
  fi
  env_set BACKUP_AGE_RECIPIENT "$recipient"
fi

# 5) configuration (no secrets in .env)
default_tag="$(git describe --tags --abbrev=0 2>/dev/null || echo latest)"
env_default IMAGE "${INSTALL_IMAGE:-ghcr.io/grecomatteo/feedway}"
env_default IMAGE_TAG "${INSTALL_IMAGE_TAG:-$default_tag}"
env_set TS_HOSTNAME "$ts_hostname"
env_set BOOTSTRAP_OWNER_EMAIL "$owner_email"
env_set BOOTSTRAP_ORGANIZATION_NAME "$organization_name"
if [ "$skip_tailscale" = "1" ]; then
  env_set COMPOSE_FILE "docker/compose.yml:docker/compose.ci.yml"
  env_set PANEL_URL "http://localhost:3000"
else
  # placeholder until Tailscale tells us the real name
  env_default PANEL_URL "http://localhost:3000"
fi

# 6) start
if [ "$skip_tailscale" = "1" ]; then
  log "Avvio di database e migrazioni…"
  dc up -d --wait postgres migrate
else
  log "Avvio di database, migrazioni e Tailscale…"
  dc up -d --wait postgres migrate tailscale

  dns_name=""
  for _ in $(seq 1 60); do
    dns_name="$(dc exec -T tailscale tailscale status --json --peers=false 2>/dev/null |
      sed -n 's/.*"DNSName": *"\([^"]*\)".*/\1/p' | head -n 1)" || dns_name=""
    [ -z "$dns_name" ] || break
    sleep 2
  done
  [ -n "$dns_name" ] || die "Tailscale non ha un nome DNS: controlla la chiave e che HTTPS sia attivo nella rete Tailscale."
  env_set PANEL_URL "https://${dns_name%.}"
fi

log "Avvio del pannello e del worker…"
dc up -d --wait web worker

log ""
log "Fatto. Il pannello è raggiungibile su: $(env_get PANEL_URL)"
print_bootstrap_link
