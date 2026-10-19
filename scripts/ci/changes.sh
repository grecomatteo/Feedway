#!/usr/bin/env bash
# Decides which slow CI steps a pull request needs, from the list of changed files on stdin.
# Prints GITHUB_OUTPUT lines:
#   code=true   something besides documentation, design or agent instructions changed
#   arm64=true  something that can change the arm64 image changed (Dockerfile, dependencies, Node)
# An empty list means the diff could not be read: everything runs.
set -euo pipefail

not_code='^(docs/|design/|\.claude/|\.github/ISSUE_TEMPLATE/|\.github/pull_request_template\.md$|\.github/CODEOWNERS$|[^/]+\.md$|LICENSE$)'
arm64='^(docker/|\.dockerignore$|\.nvmrc$|\.npmrc$|\.pnpmfile\.cjs$|pnpm-lock\.yaml$|pnpm-workspace\.yaml$|(.*/)?package\.json$|\.github/workflows/ci\.yml$|scripts/ci/changes(-step)?\.sh$)'

files="$(grep -v '^$' || true)"

if [ -z "$files" ]; then
  echo "code=true"
  echo "arm64=true"
  exit 0
fi

if grep -Eqv "$not_code" <<<"$files"; then echo "code=true"; else echo "code=false"; fi
if grep -Eq "$arm64" <<<"$files"; then echo "arm64=true"; else echo "arm64=false"; fi
