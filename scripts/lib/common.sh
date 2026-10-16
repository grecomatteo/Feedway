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
