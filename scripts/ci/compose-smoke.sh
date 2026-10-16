#!/usr/bin/env bash
# shellcheck disable=SC2317,SC2329  # functions are called through check and trap
# Smoke test of the production compose stack. Needs the image: docker build -f docker/Dockerfile -t app:ci .
# Runs in a temporary project directory, so a real ./secrets is never touched.
set -uo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
work="$(mktemp -d)"
project="feedway-smoke"
export IMAGE="${IMAGE:-app}" IMAGE_TAG="${IMAGE_TAG:-ci}" PANEL_URL="http://localhost:3000" META_MODE=mock

failed=0
pass() { echo "PASS $1"; }
fail() { echo "FAIL $1"; failed=1; }
check() { # check <name> <command...>
  local name="$1"
  shift
  if "$@"; then pass "$name"; else fail "$name"; fi
}

dc() {
  docker compose --project-directory "$work" -p "$project" \
    -f "$work/docker/compose.yml" -f "$work/docker/compose.ci.yml" "$@"
}

cleanup() {
  dc down --volumes --remove-orphans >/dev/null 2>&1
  docker rmi "${IMAGE}:ci-next" >/dev/null 2>&1
  rm -rf "$work"
}
trap cleanup EXIT

cp -r "$repo/docker" "$work/docker"
mkdir -m 700 "$work/secrets"
rand() { openssl rand -hex 16; }
postgres_pw="$(rand)" migrator_pw="$(rand)" runtime_pw="$(rand)"
printf '%s' "$postgres_pw" >"$work/secrets/postgres_password"
printf '%s' "$migrator_pw" >"$work/secrets/db_migrator_password"
printf '%s' "$runtime_pw" >"$work/secrets/db_runtime_password"
printf 'postgres://app_runtime:%s@postgres:5432/app' "$runtime_pw" >"$work/secrets/database_url"
printf 'postgres://app_migrator:%s@postgres:5432/app' "$migrator_pw" >"$work/secrets/database_migrator_url"
openssl rand -base64 32 | tr -d '\n' >"$work/secrets/app_encryption_key"
printf 'tskey-not-used-in-ci' >"$work/secrets/ts_authkey"
chmod 644 "$work"/secrets/*

ready() { [ "$(curl -fsS http://127.0.0.1:3000/api/ready 2>/dev/null)" = '{"db":"ok","queue":"ok"}' ]; }

stack_healthy() {
  timeout 180 docker compose --project-directory "$work" -p "$project" \
    -f "$work/docker/compose.yml" -f "$work/docker/compose.ci.yml" up -d --wait >&2 && ready
}
check "stack becomes healthy" stack_healthy
if [ "$failed" -ne 0 ]; then
  dc logs --no-color --tail 60 >&2
  exit 1
fi

not_root() {
  local uid
  for svc in web worker; do
    uid="$(dc exec -T "$svc" id -u)" || return 1
    [ "$uid" != "0" ] || return 1
  done
}
check "containers run as non-root" not_root

readonly_fs() { ! dc exec -T web touch /app/x 2>/dev/null; }
check "root filesystem is read-only" readonly_fs

edge_net="${project}_edge"
no_postgres_from_edge() {
  ! docker run --rm --network "$edge_net" --entrypoint getent "${IMAGE}:${IMAGE_TAG}" hosts postgres >/dev/null 2>&1
}
check "postgres is not reachable from edge" no_postgres_from_edge

worker_without_edge() {
  local nets
  nets="$(docker inspect --format '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' "$(dc ps -q worker)")" || return 1
  case "$nets" in *edge*) return 1 ;; esac
  ! dc exec -T worker node -e "require('dns').lookup('tailscale', (e) => process.exit(e ? 1 : 0))" 2>/dev/null
}
check "worker has no access to edge" worker_without_edge

failed_migration_keeps_web() {
  local before after secret="$work/secrets/database_migrator_url" backup
  before="$(dc ps -q web)"
  docker tag "${IMAGE}:${IMAGE_TAG}" "${IMAGE}:ci-next"
  backup="$(cat "$secret")"
  printf 'postgres://app_migrator:wrong@postgres:5432/app' >"$secret"
  # The update procedure runs the migration first: compose would otherwise recreate web before
  # migrate has finished (verified with Compose v5), which defeats the point.
  local code=0
  IMAGE_TAG=ci-next timeout 120 docker compose --project-directory "$work" -p "$project" \
    -f "$work/docker/compose.yml" -f "$work/docker/compose.ci.yml" run --rm --no-deps migrate >/dev/null 2>&1 || code=$?
  printf '%s' "$backup" >"$secret"
  [ "$code" -ne 0 ] || return 1
  after="$(dc ps -q web)"
  [ "$before" = "$after" ] && ready
}
check "failed migration keeps previous web running" failed_migration_keeps_web

install_from_scratch() {
  local dir="$work/install" status=0
  dc down --volumes --remove-orphans >/dev/null 2>&1
  mkdir "$dir"
  cp -r "$repo/scripts" "$repo/docker" "$dir/"
  (
    cd "$dir" || exit 1
    git init -q . && git add -A && git -c user.email=ci@example.invalid -c user.name=ci commit -qm smoke
    INSTALL_NONINTERACTIVE=1 INSTALL_SKIP_TAILSCALE=1 INSTALL_OWNER_EMAIL=owner@example.invalid \
      INSTALL_IMAGE="$IMAGE" INSTALL_IMAGE_TAG="$IMAGE_TAG" INSTALL_AGE_KEY_OUT="$work/age.key" \
      ./scripts/install.sh >&2
  ) || status=1
  [ "$status" -eq 0 ] && ready
  local result=$?
  (cd "$dir" && COMPOSE_FILE=docker/compose.yml:docker/compose.ci.yml docker compose --project-directory . down --volumes --remove-orphans >/dev/null 2>&1)
  return "$result"
}
check "install from scratch" install_from_scratch

exit "$failed"
