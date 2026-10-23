#!/usr/bin/env bash
# Runs the required CI checks of .github/workflows/ci.yml on this machine, in the same order, so a
# branch is pushed only once it is green: every CI run costs Actions minutes.
# Needs pnpm dependencies installed and a running Docker daemon (integration, image, install-smoke).
# Tools that are not installed (actionlint, gitleaks, trivy) are listed as not verified at the end:
# CI still runs them. The arm64 image is not built here: it needs emulation and CI builds it.
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo"

not_verified=()
step() { printf '\n==> %s\n' "$1"; }
optional() { # optional <tool> <description> <command...>
  local tool="$1" what="$2"
  shift 2
  if command -v "$tool" >/dev/null 2>&1; then
    step "$what"
    "$@"
  else
    not_verified+=("$what ($tool non installato)")
  fi
}

step "install"
pnpm install --frozen-lockfile

step "lint-types"
pnpm format:check
pnpm lint
pnpm typecheck
shellcheck docker/entrypoint.sh scripts/install.sh scripts/update.sh scripts/lib/*.sh scripts/ci/*.sh scripts/github/*.sh scripts/tests/stubs/*
optional actionlint "actionlint" actionlint

step "architecture"
pnpm arch:check
pnpm vitest run tools/arch-fixtures

step "unit"
pnpm test:unit

if ! docker info >/dev/null 2>&1; then
  echo "Docker non risponde: avvialo (per esempio 'dockerd &') e riprova." >&2
  exit 1
fi

step "integration"
# The API tests build the web app when it is missing; build it once so parallel test files do not race.
pnpm --filter @app/web exec nuxt build
pnpm test:int

step "e2e"
# Where the browser cannot be downloaded, PLAYWRIGHT_CHROMIUM_PATH points the tests at an installed one.
if [ -z "${PLAYWRIGHT_CHROMIUM_PATH:-}" ]; then
  pnpm --filter @app/web exec playwright install chromium
fi
pnpm test:e2e

step "security"
optional gitleaks "gitleaks" gitleaks git --redact --no-banner
pnpm audit --audit-level high
bats scripts/tests

# VERIFY_CI_SKIP_IMAGE=1 is for sandboxes whose Docker builds cannot reach the package mirrors:
# image and install-smoke are then reported as not verified and left to CI.
if [ "${VERIFY_CI_SKIP_IMAGE:-}" = 1 ]; then
  not_verified+=("image e install-smoke (VERIFY_CI_SKIP_IMAGE=1)")
else
  step "image"
  docker build -f docker/Dockerfile -t app:ci --build-arg APP_VERSION=0.0.0-ci .
  optional trivy "trivy" trivy image --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1 app:ci
  docker run --rm --entrypoint node -w /app/apps/worker app:ci -e \
    "import('@node-rs/argon2').then(async (m) => { if (!(await m.verify(await m.hash('x'), 'x'))) process.exit(1); console.log('argon2 ok', process.arch) })"

  step "install-smoke"
  scripts/ci/compose-smoke.sh
fi

printf '\nControlli locali verdi.\n'
printf 'Non verificati qui, li esegue la CI: immagine arm64, titolo della PR (commitlint)'
for item in "${not_verified[@]}"; do printf ', %s' "$item"; done
printf '.\n'
