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
compose="$(git show "$target:docker/compose.yml")" ||
  die "Non riesco a leggere docker/compose.yml della versione '$target'. Non ho cambiato nulla."
required="$(printf '%s\n' "$compose" | grep -oE '\./secrets/[A-Za-z0-9_.-]+' | sort -u)" ||
  die "Il docker/compose.yml di '$target' non nomina nessun segreto: non è normale. Non ho cambiato nulla."
missing=""
for secret in $required; do
  [ -s "$secret" ] || missing="$missing ${secret#./secrets/}"
done
if [ -n "$missing" ]; then
  die "La versione '$target' richiede questi segreti, che mancano in secrets/:$missing. Non ho cambiato nulla."
fi

mkdir -p .state
if [ "$target" != "$current" ]; then
  printf '%s\n' "$current" >"$state_file"
fi

git checkout --quiet "$target"
env_set IMAGE_TAG "$target"

show_failure() {
  warn "L'aggiornamento a $target non è riuscito. Ultime righe dei log:"
  dc logs --tail 50 migrate web worker >&2 || true
  warn "Per tornare alla versione precedente: ./scripts/update.sh --rollback"
  exit 1
}

log "Scarico le immagini di $target…"
dc pull || show_failure
# The migration runs alone first: if it fails, the running web and worker are left untouched.
log "Migrazione del database…"
dc run --rm --no-deps migrate || show_failure
log "Riavvio dei servizi…"
dc up -d --wait || show_failure

log "Aggiornato a $target."
