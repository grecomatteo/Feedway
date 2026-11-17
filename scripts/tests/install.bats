#!/usr/bin/env bats

load helpers

setup() {
  setup_workdir
  prepare_authkey
}

teardown() {
  teardown_workdir
}

@test "install generates all secrets with strict permissions" {
  run_install_noninteractive
  for f in postgres_password db_migrator_password db_runtime_password database_url database_migrator_url app_encryption_key better_auth_secret ts_authkey; do
    [ -s "secrets/$f" ]
    [ "$(stat -c %a "secrets/$f")" = "600" ]
  done
  [ "$(stat -c %a secrets)" = "700" ]
  [ "$(base64 -d secrets/app_encryption_key | wc -c)" -eq 32 ]
}

@test "install creates every secret the compose file needs" {
  run_install_noninteractive
  for f in $(grep -oE '\./secrets/[A-Za-z0-9_.-]+' docker/compose.yml | sort -u); do
    [ -s "$f" ]
  done
}

@test "install never falls back to latest: without a release tag it stops before any change" {
  git tag -d v0.1.0 v0.2.0 >/dev/null
  run run_install_noninteractive
  [ "$status" -ne 0 ]
  [ ! -e secrets/app_encryption_key ]
  run grep -q 'IMAGE_TAG=latest' .env
  [ "$status" -ne 0 ]
}

@test "install uses the release it was checked out at" {
  run_install_noninteractive
  grep -q '^IMAGE_TAG=v0.1.0$' .env
}

@test "install keeps existing secrets on rerun" {
  run_install_noninteractive
  cp -r secrets before
  run_install_noninteractive
  diff -r before secrets
}

@test "rerun does not generate a second backup key" {
  run_install_noninteractive
  recipient="$(grep '^BACKUP_AGE_RECIPIENT=' .env)"
  rm "$work/../age-$$.key"
  run_install_noninteractive
  [ "$(grep '^BACKUP_AGE_RECIPIENT=' .env)" = "$recipient" ]
  [ ! -e "$work/../age-$$.key" ]
}

@test "database urls embed the generated passwords" {
  run_install_noninteractive
  grep -q "app_runtime:$(cat secrets/db_runtime_password)@postgres:5432/app" secrets/database_url
  grep -q "app_migrator:$(cat secrets/db_migrator_password)@postgres:5432/app" secrets/database_migrator_url
}

@test "passwords are url safe" {
  run_install_noninteractive
  for f in postgres_password db_migrator_password db_runtime_password; do
    [[ "$(cat "secrets/$f")" =~ ^[A-Za-z0-9_-]{40,}$ ]]
  done
}

@test "install refuses to run without docker compose v2" {
  STUB_COMPOSE_VERSION=1.29 run env INSTALL_NONINTERACTIVE=1 ./scripts/install.sh
  [ "$status" -ne 0 ]
  [[ "$output" == *"Docker Compose v2"* ]]
}

@test "install refuses an old docker" {
  STUB_DOCKER_VERSION=20.10.7 run env INSTALL_NONINTERACTIVE=1 ./scripts/install.sh
  [ "$status" -ne 0 ]
  [[ "$output" == *"Docker 24"* ]]
}

@test "env file contains no secret values" {
  run_install_noninteractive
  ! grep -qF "$(cat secrets/db_runtime_password)" .env || false
  ! grep -qF "$(cat secrets/app_encryption_key)" .env || false
  ! grep -qF "tskey-auth-not-real" .env || false
  ! grep -q "AGE-SECRET-KEY" .env || false
}

@test "panel url comes from the tailscale dns name" {
  run_install_noninteractive
  grep -q '^PANEL_URL=https://pannello.tail1234.ts.net$' .env
  grep -q '^TS_HOSTNAME=pannello$' .env
  grep -q '^BOOTSTRAP_OWNER_EMAIL=owner@example.invalid$' .env
}

@test "private backup key is written once to the requested file" {
  run_install_noninteractive
  grep -q '^AGE-SECRET-KEY-' "$work/../age-$$.key"
  grep -q '^BACKUP_AGE_RECIPIENT=age1' .env
}

@test "services start in the documented order" {
  run_install_noninteractive
  grep -n 'up -d --wait postgres migrate tailscale' "$STUB_LOG"
  first="$(grep -n 'up -d --wait postgres migrate tailscale' "$STUB_LOG" | head -1 | cut -d: -f1)"
  second="$(grep -n 'up -d --wait web worker' "$STUB_LOG" | head -1 | cut -d: -f1)"
  [ "$first" -lt "$second" ]
}

@test "skipping tailscale uses the local panel address and the ci compose file" {
  INSTALL_SKIP_TAILSCALE=1 run_install_noninteractive
  grep -q '^PANEL_URL=http://localhost:3000$' .env
  grep -q '^COMPOSE_FILE=docker/compose.yml:docker/compose.ci.yml$' .env
  ! grep -q 'tailscale status' "$STUB_LOG" || false
}

@test "install never prints secrets" {
  run env INSTALL_NONINTERACTIVE=1 INSTALL_TS_HOSTNAME=pannello INSTALL_TS_AUTHKEY_FILE="$work/../authkey-$$" \
    INSTALL_OWNER_EMAIL=owner@example.invalid INSTALL_AGE_KEY_OUT="$work/../age-$$.key" INSTALL_SKIP_CHOWN=1 ./scripts/install.sh
  [ "$status" -eq 0 ]
  [[ "$output" != *"$(cat secrets/db_runtime_password)"* ]]
  [[ "$output" != *"tskey-auth-not-real"* ]]
  [[ "$output" != *"AGE-SECRET-KEY"* ]]
  [[ "$output" == *"https://pannello.tail1234.ts.net"* ]]
}

@test "install asks the agency name and prints the account creation link" {
  run env INSTALL_NONINTERACTIVE=1 INSTALL_TS_HOSTNAME=pannello INSTALL_TS_AUTHKEY_FILE="$work/../authkey-$$" \
    INSTALL_OWNER_EMAIL=owner@example.invalid INSTALL_ORGANIZATION_NAME="Agenzia Rossi" \
    INSTALL_AGE_KEY_OUT="$work/../age-$$.key" INSTALL_SKIP_CHOWN=1 ./scripts/install.sh
  [ "$status" -eq 0 ]
  grep -q '^BOOTSTRAP_ORGANIZATION_NAME=Agenzia Rossi$' .env
  [[ "$output" == *"https://pannello.tail1234.ts.net/attiva/link-di-prova"* ]]
  # the link is created once the panel runs
  up="$(grep -n 'up -d --wait web worker' "$STUB_LOG" | head -1 | cut -d: -f1)"
  link="$(grep -n 'run --rm --no-deps -T worker cli bootstrap-link' "$STUB_LOG" | head -1 | cut -d: -f1)"
  [ "$up" -lt "$link" ]
}

@test "install uses the default agency name and keeps it on rerun" {
  run_install_noninteractive
  grep -q '^BOOTSTRAP_ORGANIZATION_NAME=La mia agenzia$' .env
  env_set_name() { sed -i 's/^BOOTSTRAP_ORGANIZATION_NAME=.*/BOOTSTRAP_ORGANIZATION_NAME=Agenzia Rossi/' .env; }
  env_set_name
  INSTALL_ORGANIZATION_NAME="" run_install_noninteractive
  [ "$(grep -c '^BOOTSTRAP_ORGANIZATION_NAME=' .env)" -eq 1 ]
  grep -q '^BOOTSTRAP_ORGANIZATION_NAME=Agenzia Rossi$' .env
}

@test "install refuses an agency name that .env cannot hold" {
  INSTALL_ORGANIZATION_NAME='Agenzia $HOME' run run_install_noninteractive
  [ "$status" -ne 0 ]
  [[ "$output" == *"Il nome dell'agenzia non può contenere"* ]]
  INSTALL_ORGANIZATION_NAME='  A  ' run run_install_noninteractive
  [ "$status" -ne 0 ]
  [[ "$output" == *"da 2 a 80 caratteri"* ]]
  ! grep -q '^BOOTSTRAP_ORGANIZATION_NAME=' .env 2>/dev/null || false
}

@test "install trims the agency name and counts accented letters once" {
  INSTALL_ORGANIZATION_NAME="  Agenzia Città  " run_install_noninteractive
  grep -q '^BOOTSTRAP_ORGANIZATION_NAME=Agenzia Città$' .env
  INSTALL_ORGANIZATION_NAME="$(printf 'è%.0s' $(seq 1 80))" LC_ALL=C run_install_noninteractive
}

@test "install rerun after the first account says nothing about a link" {
  STUB_BOOTSTRAP=exists run env INSTALL_NONINTERACTIVE=1 INSTALL_TS_HOSTNAME=pannello \
    INSTALL_TS_AUTHKEY_FILE="$work/../authkey-$$" INSTALL_OWNER_EMAIL=owner@example.invalid \
    INSTALL_AGE_KEY_OUT="$work/../age-$$.key" INSTALL_SKIP_CHOWN=1 ./scripts/install.sh
  [ "$status" -eq 0 ]
  [[ "$output" != *"/attiva/"* ]]
  [[ "$output" != *"Attenzione"* ]]
}

prepare_public_authkey() {
  printf 'tskey-auth-public-not-real' >"$work/../public-authkey-$$"
}

run_install_public() {
  INSTALL_PUBLIC=1 INSTALL_TS_PUBLIC_AUTHKEY_FILE="$work/../public-authkey-$$" run_install_noninteractive
}

@test "the public host is off unless asked" {
  run_install_noninteractive
  [ "$(cat secrets/ts_public_authkey)" = "non-usata" ]
  ! grep -q '^COMPOSE_PROFILES=.*public' .env || false
  ! grep -q '^PUBLIC_URL=.' .env || false
  ! grep -q 'tailscale-public' "$STUB_LOG" || false
}

@test "the public host gets its own node, key and address" {
  prepare_public_authkey
  run_install_public
  [ "$(cat secrets/ts_public_authkey)" = "tskey-auth-public-not-real" ]
  [ "$(stat -c %a secrets/ts_public_authkey)" = "600" ]
  grep -q '^COMPOSE_PROFILES=public$' .env
  grep -q '^TS_PUBLIC_HOSTNAME=feedway-media$' .env
  grep -q '^PUBLIC_URL=https://feedway-media.tail1234.ts.net$' .env
  grep -q '^PANEL_URL=https://pannello.tail1234.ts.net$' .env
  ! grep -qF "tskey-auth-public-not-real" .env || false
  # its node is up before the web, which reads PUBLIC_URL when it starts
  node="$(grep -n 'up -d --wait tailscale-public' "$STUB_LOG" | head -1 | cut -d: -f1)"
  web="$(grep -n 'up -d --wait web worker' "$STUB_LOG" | head -1 | cut -d: -f1)"
  [ "$node" -lt "$web" ]
}

@test "the public host can be turned on later, with a real key" {
  prepare_public_authkey
  run_install_noninteractive
  [ "$(cat secrets/ts_public_authkey)" = "non-usata" ]
  run_install_public
  [ "$(cat secrets/ts_public_authkey)" = "tskey-auth-public-not-real" ]
  # a rerun keeps it on, and keeps its key
  printf 'tskey-auth-other' >"$work/../public-authkey-$$"
  run_install_noninteractive
  grep -q '^COMPOSE_PROFILES=public$' .env
  [ "$(cat secrets/ts_public_authkey)" = "tskey-auth-public-not-real" ]
}

@test "the public host can be turned off again" {
  prepare_public_authkey
  run_install_public
  INSTALL_PUBLIC=0 run_install_noninteractive
  grep -q '^COMPOSE_PROFILES=$' .env
  grep -q '^PUBLIC_URL=$' .env
  grep -q 'rm -s -f tailscale-public' "$STUB_LOG"
}

@test "the public node needs a name other than the panel's" {
  prepare_public_authkey
  INSTALL_TS_PUBLIC_HOSTNAME=pannello run run_install_public
  [ "$status" -ne 0 ]
  [[ "$output" == *"diverso da quello del pannello"* ]]
}

@test "the public host is never turned on without tailscale" {
  prepare_public_authkey
  INSTALL_SKIP_TAILSCALE=1 run run_install_public
  [ "$status" -ne 0 ]
  [[ "$output" == *"senza Tailscale"* ]]
}
