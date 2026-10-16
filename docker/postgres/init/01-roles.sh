#!/bin/sh
# Postgres entrypoint hook: creates the migrator and runtime roles from secret files.
# roles.sql is mounted outside docker-entrypoint-initdb.d because the entrypoint would also run
# every *.sql there without the psql variables.
set -eu

migrator_password="$(cat /run/secrets/db_migrator_password)"
runtime_password="$(cat /run/secrets/db_runtime_password)"

psql -v ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v "migrator_password=$migrator_password" \
  -v "runtime_password=$runtime_password" \
  -v "dbname=$POSTGRES_DB" \
  -f /opt/feedway/roles.sql
