#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

ALLOWLIST=(
  "wren-ui/src/apollo/server/context/runtimeScope.ts"
  "wren-ui/src/apollo/server/repositories/projectRepository.ts"
  "wren-ui/src/apollo/server/services/projectService.ts"
)

matches="$(rg -n "getCurrentProject\\(" \
  wren-ui/src \
  --glob '!**/*.test.ts' \
  --glob '!**/*.test.tsx' || true)"

if [[ -z "$matches" ]]; then
  echo "scan-current-project: no getCurrentProject() usage found"
  exit 0
fi

violations="$(while IFS= read -r line; do
  [[ -z "$line" ]] && continue
  file="${line%%:*}"

  allowed=false
  for entry in "${ALLOWLIST[@]}"; do
    if [[ "$file" == "$entry" ]]; then
      allowed=true
      break
    fi
  done

  if [[ "$allowed" == false ]]; then
    echo "$line"
  fi
done <<< "$matches")"

if [[ -n "$violations" ]]; then
  echo "scan-current-project: unexpected getCurrentProject() usages found:"
  echo "$violations"
  exit 1
fi

echo "scan-current-project: only allowlisted bridge usages remain"
