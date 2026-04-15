#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

matches="$(rg -n "getCurrentProject\\(" \
  wren-ui/src \
  --glob '!**/*.test.ts' \
  --glob '!**/*.test.tsx' || true)"

if [[ -z "$matches" ]]; then
  echo "scan-current-project: no getCurrentProject() usage found"
  exit 0
fi

echo "scan-current-project: unexpected getCurrentProject() usages found:"
echo "$matches"
exit 1
