#!/usr/bin/env bash
# docker compose for this installation, with the compose files listed in .env (COMPOSE_FILE).
#   ./scripts/compose.sh ps
#   ./scripts/compose.sh logs --tail 100 web worker migrate
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
# shellcheck source=scripts/lib/common.sh
source scripts/lib/common.sh

dc "$@"
