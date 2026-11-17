#!/usr/bin/env bash
# Updates Feedway to a release tag, or goes back to the previous one.
#   ./scripts/update.sh [<tag>]     default: the latest v* tag
#   ./scripts/update.sh --rollback  back to the tag recorded before the last update
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
# shellcheck source=scripts/lib/common.sh
source scripts/lib/common.sh

state_file=".state/previous_tag"

require_docker
[ -f "$ENV_FILE" ] || die "Manca .env: l'installazione non è stata fatta qui."

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  die "Ci sono modifiche non salvate nel repository: salvale o annullale prima di aggiornare."
fi

current="$(env_get IMAGE_TAG)"

if [ "${1:-}" = "--rollback" ]; then
  [ -s "$state_file" ] || die "Non c'è una versione precedente registrata."
  target="$(cat "$state_file")"
elif [ -n "${1:-}" ]; then
  target="$1"
else
  git fetch --tags --quiet
  target="$(git tag --list 'v*' --sort=-v:refname | head -n 1)"
  [ -n "$target" ] || die "Non ci sono release (tag v*)."
fi

git fetch --tags --quiet
git rev-parse --verify --quiet "refs/tags/$target" >/dev/null || die "La versione '$target' non esiste."

# Checked before anything changes: a missing secret would only show up as a container that
# never starts, after the old version is already gone.
compose="$(git show "refs/tags/$target:docker/compose.yml")" ||
  die "Non riesco a leggere docker/compose.yml della versione '$target'. Non ho cambiato nulla."
required="$(printf '%s\n' "$compose" | grep -oE '\./secrets/[A-Za-z0-9_.-]+' | sort -u)" ||
  die "Il docker/compose.yml di '$target' non nomina nessun segreto: non è normale. Non ho cambiato nulla."
# The public host's key is a placeholder until install.sh turns it on: written as install.sh
# writes it, so an installation made before the public host existed still updates.
if [ ! -e secrets/ts_public_authkey ]; then
  (umask 077 && printf 'non-usata' >secrets/ts_public_authkey)
fi
missing=""
for secret in $required; do
  [ -s "$secret" ] || missing="$missing ${secret#./secrets/}"
done
if [ -n "$missing" ]; then
  die "La versione '$target' richiede questi segreti, che mancano in secrets/:$missing. Non ho cambiato nulla."
fi

# The web reads the name when the first account is created: it must be in .env before it starts.
if [ "${1:-}" != "--rollback" ] && [ -z "$(env_get BOOTSTRAP_ORGANIZATION_NAME)" ] && [ -t 0 ]; then
  read -r -p "Nome della tua agenzia [La mia agenzia]: " organization_name ||
    die "Aggiornamento annullato: non ho cambiato nulla."
  organization_name="$(trim "$organization_name")"
  organization_name="${organization_name:-La mia agenzia}"
  check_organization_name "$organization_name"
  env_set BOOTSTRAP_ORGANIZATION_NAME "$organization_name"
fi

mkdir -p .state
recorded="$(cat "$state_file" 2>/dev/null || true)"
checked_out="$(git rev-parse HEAD)"
if [ "$target" != "$current" ]; then
  printf '%s\n' "$current" >"$state_file"
fi

git checkout --quiet "refs/tags/$target"
env_set IMAGE_TAG "$target"

show_failure() {
  warn "L'aggiornamento a $target non è riuscito. Ultime righe dei log:"
  dc logs --tail 50 migrate web worker >&2 || true
  warn "Per tornare alla versione precedente: ./scripts/update.sh --rollback"
  exit 1
}

# Before the services restart nothing running has changed: the files go back to the version in
# use, so a reboot or a later command never starts the new version on an old schema.
put_back() {
  warn "L'aggiornamento a $target non è riuscito: l'errore è nelle righe qui sopra."
  # each step on its own: one that fails must not skip the others
  git checkout --quiet "$checked_out" || warn "Non riesco a tornare al codice di $current: lancia 'git checkout $current'."
  env_set IMAGE_TAG "$current" || warn "Non riesco a rimettere IMAGE_TAG=$current in .env: correggilo a mano."
  if [ -n "$recorded" ]; then
    printf '%s\n' "$recorded" >"$state_file" || warn "Non riesco a scrivere $state_file."
  else
    rm -f "$state_file"
  fi
  warn "Resta in funzione $current: i servizi non sono stati toccati."
  exit 1
}

log "Scarico le immagini di $target…"
dc pull || put_back
# The migration runs alone first: if it fails, the running web and worker are left untouched.
log "Migrazione del database…"
dc run --rm --no-deps migrate || put_back
log "Riavvio dei servizi…"
dc up -d --wait || show_failure

log "Aggiornato a $target."
print_bootstrap_link
