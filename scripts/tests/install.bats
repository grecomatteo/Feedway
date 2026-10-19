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
  ! grep -qF "$(cat secrets/db_runtime_password)" .env
  ! grep -qF "$(cat secrets/app_encryption_key)" .env
  ! grep -qF "tskey-auth-not-real" .env
  ! grep -q "AGE-SECRET-KEY" .env
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
  ! grep -q 'tailscale status' "$STUB_LOG"
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
  ! grep -q '^BOOTSTRAP_ORGANIZATION_NAME=' .env 2>/dev/null
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
