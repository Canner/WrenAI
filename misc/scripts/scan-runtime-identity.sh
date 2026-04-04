#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

check_allowlisted_matches() {
  local label="$1"
  local matches="$2"
  shift 2
  local allowlist=("$@")

  if [[ -z "$matches" ]]; then
    echo "$label: no matches found"
    return 0
  fi

  local violations=""
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    local file="${line%%:*}"
    local allowed=false

    for entry in "${allowlist[@]}"; do
      if [[ "$file" == "$entry" ]]; then
        allowed=true
        break
      fi
    done

    if [[ "$allowed" == false ]]; then
      if [[ -n "$violations" ]]; then
        violations+=$'\n'
      fi
      violations+="$line"
    fi
  done <<< "$matches"

  if [[ -n "$violations" ]]; then
    echo "$label: unexpected matches found:"
    echo "$violations"
    return 1
  fi

  echo "$label: only allowlisted bridge usages remain"
}

CURRENT_PROJECT_ALLOWLIST=(
  "wren-ui/src/apollo/server/context/runtimeScope.ts"
  "wren-ui/src/apollo/server/repositories/projectRepository.ts"
  "wren-ui/src/apollo/server/services/projectService.ts"
)

DIRECT_PROJECT_FIELD_ALLOWLIST=(
  "wren-ai-service/src/web/v1/services/__init__.py"
)

current_project_matches="$(rg -n "getCurrentProject\\(" \
  wren-ui/src \
  --glob '!**/*.test.ts' \
  --glob '!**/*.test.tsx' || true)"

check_allowlisted_matches \
  "scan-runtime-identity:getCurrentProject" \
  "$current_project_matches" \
  "${CURRENT_PROJECT_ALLOWLIST[@]}"

direct_project_field_matches="$(rg -n "\\.(project_id|projectId)\\b" \
  wren-ai-service/src/web \
  --glob '!**/*test*' || true)"

check_allowlisted_matches \
  "scan-runtime-identity:direct-project-field-access" \
  "$direct_project_field_matches" \
  "${DIRECT_PROJECT_FIELD_ALLOWLIST[@]}"

echo "scan-runtime-identity: runtime identity contract checks passed"
