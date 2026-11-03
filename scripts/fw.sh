#!/usr/bin/env bash
# The Feedway command line (the worker's `cli`), with the compose files listed in .env.
#   ./scripts/fw.sh list-organizations
# Without a terminal (a script, a pipe) it runs without one (-T): stdin still reaches the
# command, so a password can be piped in. In a `while read` loop add `< /dev/null`.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
# shellcheck source=scripts/lib/common.sh
source scripts/lib/common.sh

if [ -t 0 ] && [ -t 1 ]; then
  dc run --rm --no-deps worker cli "$@"
else
  dc run --rm --no-deps -T worker cli "$@"
fi
