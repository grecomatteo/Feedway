#!/usr/bin/env bats

load helpers

setup() {
  setup_workdir
  printf 'IMAGE=ghcr.io/example/app\nIMAGE_TAG=v0.1.0\nPANEL_URL=http://localhost:3000\n' >.env
}

teardown() {
  teardown_workdir
}

@test "update records previous tag and rolls back to it" {
  ./scripts/update.sh v0.2.0 >/dev/null
  [ "$(cat .state/previous_tag)" = "v0.1.0" ]
  grep -q '^IMAGE_TAG=v0.2.0$' .env
  [ "$(git describe --tags --exact-match)" = "v0.2.0" ]
  ./scripts/update.sh --rollback >/dev/null
  grep -q '^IMAGE_TAG=v0.1.0$' .env
  [ "$(git describe --tags --exact-match)" = "v0.1.0" ]
}

@test "update without argument picks the latest release tag" {
  ./scripts/update.sh >/dev/null
  grep -q '^IMAGE_TAG=v0.2.0$' .env
}

@test "migration runs before the services are recreated" {
  ./scripts/update.sh v0.2.0 >/dev/null
  migrate="$(grep -n 'run --rm --no-deps migrate' "$STUB_LOG" | head -1 | cut -d: -f1)"
  up="$(grep -n 'up -d --wait' "$STUB_LOG" | head -1 | cut -d: -f1)"
  [ "$migrate" -lt "$up" ]
}

@test "update refuses a dirty working tree" {
  touch untracked-change
  git add untracked-change
  run ./scripts/update.sh v0.2.0
  [ "$status" -ne 0 ]
  grep -q '^IMAGE_TAG=v0.1.0$' .env
}

@test "update failure prints rollback command and exits 1" {
  STUB_COMPOSE_UP_FAILS=1 run ./scripts/update.sh v0.2.0
  [ "$status" -eq 1 ]
  [[ "$output" == *"./scripts/update.sh --rollback"* ]]
  grep -q 'logs --tail 50 migrate web worker' "$STUB_LOG"
}

@test "rollback after a failed update returns to the previous tag" {
  STUB_COMPOSE_UP_FAILS=1 run ./scripts/update.sh v0.2.0
  ./scripts/update.sh --rollback >/dev/null
  grep -q '^IMAGE_TAG=v0.1.0$' .env
}

@test "rollback without a recorded previous tag fails clearly" {
  run ./scripts/update.sh --rollback
  [ "$status" -ne 0 ]
  [[ "$output" == *"versione precedente"* ]]
}

@test "update rejects an unknown tag" {
  run ./scripts/update.sh v9.9.9
  [ "$status" -ne 0 ]
}
