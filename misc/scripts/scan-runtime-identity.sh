#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

COMPATIBILITY_BOUNDARY_FILE="misc/project-identity-compatibility-boundaries.tsv"

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

DIRECT_PROJECT_FIELD_ALLOWLIST=(
  "wren-ai-service/src/web/v1/services/__init__.py"
)

LEGACY_PROJECT_BRIDGE_SIGNATURE_ALLOWLIST=(
  "wren-ai-service/src/core/runtime_identity.py"
  "wren-ai-service/src/providers/engine/wren.py"
  "wren-ai-service/src/utils.py"
  "wren-ai-service/src/web/v1/services/__init__.py"
  "wren-ai-service/src/web/v1/services/runtime_models.py"
  "wren-ai-service/src/web/v1/routers/semantics_preparation.py"
)

COMPATIBILITY_ALIAS_BOUNDARY_ALLOWLIST=()
while IFS=$'\t' read -r path _kind _action; do
  [[ -z "$path" || "$path" =~ ^# ]] && continue
  COMPATIBILITY_ALIAS_BOUNDARY_ALLOWLIST+=("$path")
done < "$COMPATIBILITY_BOUNDARY_FILE"

current_project_matches="$(rg -n "getCurrentProject\\(" \
  wren-ui/src \
  --glob '!**/*.test.ts' \
  --glob '!**/*.test.tsx' || true)"

if [[ -n "$current_project_matches" ]]; then
  echo "scan-runtime-identity:getCurrentProject: unexpected matches found:"
  echo "$current_project_matches"
  exit 1
fi

echo "scan-runtime-identity:getCurrentProject: no matches found"

direct_project_field_matches="$(rg -n "\\.(project_id|projectId)\\b" \
  wren-ai-service/src/web \
  --glob '!**/*test*' || true)"

check_allowlisted_matches \
  "scan-runtime-identity:direct-project-field-access" \
  "$direct_project_field_matches" \
  "${DIRECT_PROJECT_FIELD_ALLOWLIST[@]}"

legacy_project_signature_matches="$(rg -n "\\bproject_id\\b" \
  wren-ai-service/src \
  --glob '!**/*test*' \
  --glob '!**/pipelines/**' || true)"

check_allowlisted_matches \
  "scan-runtime-identity:legacy-project-bridge-boundary" \
  "$legacy_project_signature_matches" \
  "${LEGACY_PROJECT_BRIDGE_SIGNATURE_ALLOWLIST[@]}"

compatibility_alias_matches="$(rg -n -S \
  "legacyProjectId|legacy_project_id|projectBridgeId|project_bridge_id" \
  wren-ui/src wren-ai-service/src \
  --glob '!**/tests/**' \
  --glob '!**/*.test.*' || true)"

if (( ${#COMPATIBILITY_ALIAS_BOUNDARY_ALLOWLIST[@]} > 0 )); then
  check_allowlisted_matches \
    "scan-runtime-identity:compatibility-alias-boundary" \
    "$compatibility_alias_matches" \
    "${COMPATIBILITY_ALIAS_BOUNDARY_ALLOWLIST[@]}"
else
  check_allowlisted_matches \
    "scan-runtime-identity:compatibility-alias-boundary" \
    "$compatibility_alias_matches"
fi

bash misc/scripts/scan-kb-snapshot-bridge-fallback.sh

pipeline_project_signature_matches="$(rg -n "\\bproject_id(?:: .*None|\\)|,)" \
  wren-ai-service/src/pipelines || true)"

pipeline_project_signature_matches="$(printf '%s\n' "$pipeline_project_signature_matches" | rg -v '^wren-ai-service/src/pipelines/common.py:' || true)"

if [[ -n "$pipeline_project_signature_matches" ]]; then
  echo "scan-runtime-identity:pipeline-project-signatures: unexpected matches found:"
  echo "$pipeline_project_signature_matches"
  exit 1
fi

echo "scan-runtime-identity:pipeline-project-signatures: no legacy project parameter names remain in pipelines"

echo "scan-runtime-identity: runtime identity contract checks passed"
