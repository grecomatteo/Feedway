#!/usr/bin/env bash
# Shared helpers for install.sh and update.sh. Meant to be sourced, from the repository root.
# shellcheck shell=bash

log() { printf '%s\n' "$*"; }
warn() { printf 'Attenzione: %s\n' "$*" >&2; }
die() {
  printf 'Errore: %s\n' "$*" >&2
  exit 1
}

ENV_FILE=".env"

# env_get KEY: prints the value from .env, or nothing.
env_get() {
  [ -f "$ENV_FILE" ] || return 0
  sed -n "s/^$1=//p" "$ENV_FILE" | tail -n 1
}

# env_set KEY VALUE: replaces the line or appends it. Values never contain newlines.
env_set() {
  local key="$1" value="$2" tmp
  tmp="$(mktemp)"
  if [ -f "$ENV_FILE" ]; then
    grep -v "^${key}=" "$ENV_FILE" >"$tmp" || true
  fi
  printf '%s=%s\n' "$key" "$value" >>"$tmp"
  cat "$tmp" >"$ENV_FILE"
  rm -f "$tmp"
}

# env_default KEY VALUE: sets the key only when it is missing.
env_default() {
  [ -n "$(env_get "$1")" ] || env_set "$1" "$2"
}

# dc ARGS...: docker compose for this repository. COMPOSE_FILE from .env wins over the default.
dc() {
  local files
  files="${COMPOSE_FILE:-$(env_get COMPOSE_FILE)}"
  COMPOSE_FILE="${files:-docker/compose.yml}" docker compose --project-directory . "$@"
}

require_docker() {
  command -v docker >/dev/null 2>&1 || die "Docker non è installato."
  local major
  major="$(docker --version | sed -n 's/^Docker version \([0-9]*\)\..*/\1/p')"
  { [ -n "$major" ] && [ "$major" -ge 24 ]; } || die "Serve Docker 24 o successivo."
  local compose
  compose="$(docker compose version --short 2>/dev/null | sed 's/^v//')" || compose=""
  case "$compose" in
    2.* | [3-9]*) ;;
    *) die "Serve Docker Compose v2 (il comando 'docker compose')." ;;
  esac
  docker info >/dev/null 2>&1 || die "Docker non risponde: avvia il servizio o aggiungi l'utente al gruppo docker."
}

# check_organization_name NAME: what the configuration accepts (2 to 80 characters), without what
# .env would read as a variable, a comment or a quoted value. The panel can rename it later.
check_organization_name() {
  case "$1" in
    *'$'* | *'#'* | *\\* | *'`'* | \'* | \"*)
      die "Il nome dell'agenzia non può contenere \$ # \\ o \` né iniziare con le virgolette: potrai cambiarlo dal pannello."
      ;;
  esac
  if [ "${#1}" -lt 2 ] || [ "${#1}" -gt 80 ]; then
    die "Il nome dell'agenzia deve avere da 2 a 80 caratteri."
  fi
}

BOOTSTRAP_LINK_COMMAND="docker compose run --rm --no-deps worker cli bootstrap-link"

# print_bootstrap_link: while no platform administrator exists, prints the link that creates the
# first account (valid one hour). Never fails: the stack is already running at this point.
print_bootstrap_link() {
  local link errors status=0
  errors="$(mktemp)"
  link="$(dc run --rm --no-deps -T worker cli bootstrap-link 2>"$errors")" || status=$?
  case "$status" in
    0)
      log ""
      log "Per creare il tuo account apri questo link entro un'ora:"
      log "  $link"
      log "Se scade, chiedine uno nuovo con: $BOOTSTRAP_LINK_COMMAND"
      ;;
    # 1 with this message: the account exists already, nothing to do
    1) grep -q "già creato" "$errors" || warn "link per il primo account non creato: $(cat "$errors")" ;;
    # 64: a release without the command (before tappa 2)
    64) ;;
    *) warn "link per il primo account non creato: $(cat "$errors"). Riprova con: $BOOTSTRAP_LINK_COMMAND" ;;
  esac
  rm -f "$errors"
  return 0
}
