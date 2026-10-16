#!/usr/bin/env bash
# Single image, several commands: web | worker | migrate | cli
set -euo pipefail

cd /app

case "${1:-}" in
  web) exec node apps/web/.output/server/index.mjs ;;
  worker) exec node apps/worker/dist/main.js ;;
  migrate) exec node apps/worker/dist/migrate.js ;;
  cli)
    echo "Il comando cli arriva con la tappa 2." >&2
    exit 64
    ;;
  *)
    echo "Comando sconosciuto: '${1:-}'. Usa: web, worker, migrate." >&2
    exit 64
    ;;
esac
