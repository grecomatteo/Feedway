#!/usr/bin/env bash
# CI step: installs the tools named (age, bats). apt first; when the Ubuntu mirrors cannot be
# reached (GitHub runners, 2026-11-11: "Temporary failure resolving 'azure.archive.ubuntu.com'"),
# age comes from the Go module proxy, checked against the Go checksum database, and bats from
# npm, both at fixed versions.
set -euo pipefail

AGE_VERSION=v1.2.1
BATS_VERSION=1.11.1

[ "$#" -gt 0 ] || { echo "uso: $0 age|bats..." >&2; exit 2; }

if sudo apt-get -o Acquire::Retries=1 update && sudo apt-get -o Acquire::Retries=1 install --yes "$@"; then
  exit 0
fi

echo "::warning::apt non raggiunge i mirror di Ubuntu: installo $* da Go e npm"
bin="$HOME/.local/bin"
mkdir -p "$bin"
for tool in "$@"; do
  case "$tool" in
    age) GOBIN="$bin" go install "filippo.io/age/cmd/...@$AGE_VERSION" ;;
    bats) npm install --global --no-fund --no-audit "bats@$BATS_VERSION" ;;
    *) echo "strumento sconosciuto: $tool" >&2; exit 2 ;;
  esac
done
if [ -n "${GITHUB_PATH:-}" ]; then echo "$bin" >>"$GITHUB_PATH"; fi
export PATH="$bin:$PATH"
for tool in "$@"; do
  case "$tool" in
    age) age --version ;;
    bats) bats --version ;;
  esac
done
