#!/usr/bin/env bash
# CI step: writes the code= and arm64= outputs of changes.sh for this run to GITHUB_OUTPUT.
# Outside a pull request, or if the diff cannot be read, the list stays empty and everything runs.
set -uo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
files=""
if [ "${GITHUB_EVENT_NAME:-}" = pull_request ]; then
  # HEAD is the merge commit of the pull request: its first parent is the base branch.
  files="$(git diff --name-only HEAD^1 HEAD)" || files=""
fi

result="$(printf '%s\n' "$files" | "$here/changes.sh")"
echo "$result"
echo "$result" >>"${GITHUB_OUTPUT:-/dev/null}"

if grep -q '=false' <<<"$result"; then
  {
    echo "Passaggi lenti saltati: i file cambiati non li riguardano."
    echo '```'
    echo "$result"
    echo '```'
  } >>"${GITHUB_STEP_SUMMARY:-/dev/null}"
fi
