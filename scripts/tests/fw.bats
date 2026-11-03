#!/usr/bin/env bats

load helpers

setup() {
  setup_workdir
  printf 'IMAGE=ghcr.io/example/app\nIMAGE_TAG=v0.1.0\n' >.env
}

teardown() {
  teardown_workdir
}

@test "compose.sh uses the compose files listed in .env" {
  printf 'COMPOSE_FILE=docker/compose.yml:docker/compose.local.yml\n' >>.env
  ./scripts/compose.sh ps
  grep -q '^docker compose --project-directory \. ps$' "$STUB_LOG"
  grep -q '^COMPOSE_FILE=docker/compose.yml:docker/compose.local.yml$' "$STUB_LOG"
}

@test "compose.sh falls back to docker/compose.yml" {
  ./scripts/compose.sh ps
  grep -q '^COMPOSE_FILE=docker/compose.yml$' "$STUB_LOG"
}

@test "compose.sh works from another directory" {
  printf 'COMPOSE_FILE=docker/compose.yml:docker/compose.local.yml\n' >>.env
  (cd / && "$work/scripts/compose.sh" ps)
  grep -q '^COMPOSE_FILE=docker/compose.yml:docker/compose.local.yml$' "$STUB_LOG"
}

@test "fw.sh runs the worker cli without a terminal when called from a script" {
  printf 'COMPOSE_FILE=docker/compose.yml:docker/compose.local.yml\n' >>.env
  ./scripts/fw.sh list-organizations </dev/null
  grep -q '^docker compose --project-directory \. run --rm --no-deps -T worker cli list-organizations$' "$STUB_LOG"
  grep -q '^COMPOSE_FILE=docker/compose.yml:docker/compose.local.yml$' "$STUB_LOG"
}
