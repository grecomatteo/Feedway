#!/usr/bin/env bash
# Creates or updates the "main" ruleset from .github/rulesets/main.json. Safe to run again.
# Needs the GitHub CLI (gh) logged in with admin rights on the repository.
#   ./scripts/github/apply-rulesets.sh grecomatteo/Feedway
set -euo pipefail

repo="${1:-}"
if [[ ! "$repo" =~ ^[^/]+/[^/]+$ ]]; then
  echo "Uso: $0 proprietario/nome" >&2
  exit 1
fi

cd "$(dirname "${BASH_SOURCE[0]}")/../.."
file=".github/rulesets/main.json"
name="$(jq -r '.name' "$file")"

existing="$(gh api "repos/$repo/rulesets" --paginate | jq -r --arg name "$name" '.[] | select(.name == $name) | .id' | head -n 1)"

if [ -n "$existing" ]; then
  gh api --method PUT "repos/$repo/rulesets/$existing" --input "$file" >/dev/null
  echo "Ruleset '$name' aggiornato."
else
  gh api --method POST "repos/$repo/rulesets" --input "$file" >/dev/null
  echo "Ruleset '$name' creato."
fi
