#!/usr/bin/env bats

load helpers

setup() {
  setup_workdir
  printf 'IMAGE=ghcr.io/example/app\nIMAGE_TAG=v0.1.0\nPANEL_URL=http://localhost:3000\n' >.env
  mkdir -m 700 secrets
  for f in $(grep -oE '\./secrets/[A-Za-z0-9_.-]+' docker/compose.yml | sort -u); do
    printf 'not-a-real-secret' >"$f"
  done
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

@test "update refuses a release whose secrets are missing and changes nothing" {
  # v0.3.0 needs a secret that v0.1.0 (checked out) does not: the target's compose must count
  git checkout -q -b next v0.2.0
  printf '  extra_secret:\n    file: ./secrets/extra_secret\n' >>docker/compose.yml
  git commit -q -am "release 0.3.0" && git tag v0.3.0
  git checkout -q v0.1.0
  run ./scripts/update.sh v0.3.0
  [ "$status" -ne 0 ]
  [[ "$output" == *"extra_secret"* ]]
  grep -q '^IMAGE_TAG=v0.1.0$' .env
  [ "$(git describe --tags --exact-match)" = "v0.1.0" ]
  [ ! -e .state/previous_tag ]
  run grep -q ' pull' "$STUB_LOG"
  [ "$status" -ne 0 ]
  ./scripts/update.sh v0.2.0 >/dev/null
}

@test "update refuses a release whose compose file cannot be read" {
  git checkout -q -b broken v0.2.0
  git rm -q docker/compose.yml && git commit -q -m "release 0.4.0" && git tag v0.4.0
  git checkout -q v0.1.0
  run ./scripts/update.sh v0.4.0
  [ "$status" -ne 0 ]
  [[ "$output" == *"compose.yml"* ]]
  grep -q '^IMAGE_TAG=v0.1.0$' .env
}

@test "update prints the bootstrap link when no platform admin exists" {
  run ./scripts/update.sh v0.2.0
  [ "$status" -eq 0 ]
  [[ "$output" == *"/attiva/link-di-prova"* ]]
  up="$(grep -n 'up -d --wait' "$STUB_LOG" | head -1 | cut -d: -f1)"
  link="$(grep -n 'cli bootstrap-link' "$STUB_LOG" | head -1 | cut -d: -f1)"
  [ "$up" -lt "$link" ]
}

@test "update stays quiet when the first account exists or the release has no command" {
  for case in exists missing; do
    STUB_BOOTSTRAP="$case" run ./scripts/update.sh v0.2.0
    [ "$status" -eq 0 ]
    [[ "$output" != *"/attiva/"* ]]
    [[ "$output" != *"Attenzione"* ]]
  done
}

@test "a failed bootstrap link warns but the update still succeeds" {
  STUB_BOOTSTRAP=broken run ./scripts/update.sh v0.2.0
  [ "$status" -eq 0 ]
  [[ "$output" == *"cli bootstrap-link"* ]]
  grep -q '^IMAGE_TAG=v0.2.0$' .env
}

@test "update asks the agency name once when it is missing" {
  # script(1) gives the update a terminal, as on the server
  printf 'Agenzia Bianchi\n' | script -qec "./scripts/update.sh v0.2.0" /dev/null >/dev/null
  grep -q '^BOOTSTRAP_ORGANIZATION_NAME=Agenzia Bianchi$' .env
  ./scripts/update.sh --rollback </dev/null >/dev/null
  [ "$(grep -c '^BOOTSTRAP_ORGANIZATION_NAME=' .env)" -eq 1 ]
}

@test "update without a terminal does not ask the agency name" {
  ./scripts/update.sh v0.2.0 </dev/null >/dev/null
  ! grep -q '^BOOTSTRAP_ORGANIZATION_NAME=' .env
}

@test "update survives the checkout replacing the script while it runs" {
  # v0.3.0 ships a different update.sh: git writes it as a new file, bash keeps reading the old one
  git checkout -q main
  printf '#!/usr/bin/env bash\necho "script sostituito"; exit 0\n%s\n' "$(head -c 4000 /dev/zero | tr '\0' '#')" >scripts/update.sh
  git commit -qam "release 0.3.0" && git tag v0.3.0 && git push -q origin v0.3.0
  git checkout -q v0.1.0
  run ./scripts/update.sh v0.3.0
  [ "$status" -eq 0 ]
  [[ "$output" == *"Aggiornato a v0.3.0."* ]]
  [[ "$output" != *"script sostituito"* ]]
}
