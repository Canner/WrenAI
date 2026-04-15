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
      [[ -n "$violations" ]] && violations+=$'\n'
      violations+="$line"
    fi
  done <<< "$matches"

  if [[ -n "$violations" ]]; then
    echo "$label: unexpected matches found:"
    echo "$violations"
    return 1
  fi

  echo "$label: only allowlisted kb_snapshot bridge usages remain"
  printf '%s\n' "$matches" | sed 's/^/- /'
}

KB_SNAPSHOT_REPOSITORY_ALLOWLIST=(
  "wren-ui/src/apollo/server/repositories/kbSnapshotRepository.ts"
)

KB_SNAPSHOT_BRIDGE_SELECTOR_LOOKUP_ALLOWLIST=(
  "wren-ui/src/apollo/server/context/runtimeScope.ts"
)

KB_SNAPSHOT_BRIDGE_FALLBACK_ALLOWLIST=(
  "wren-ui/src/apollo/server/context/runtimeScope.ts"
)

repository_legacy_column_matches="$(rg -n -H -S \
  "legacyProjectId|legacy_project_id" \
  wren-ui/src/apollo/server/repositories/kbSnapshotRepository.ts || true)"

check_allowlisted_matches \
  "scan-kb-snapshot-bridge-fallback:repository-legacy-column" \
  "$repository_legacy_column_matches" \
  "${KB_SNAPSHOT_REPOSITORY_ALLOWLIST[@]}"

bridge_selector_lookup_matches="$(rg -n -U -H -P \
  "findOneBy\\(\\{\\s*bridgeProjectId:\\s*selector\\.bridgeProjectId" \
  wren-ui/src/apollo/server/context/runtimeScope.ts || true)"

check_allowlisted_matches \
  "scan-kb-snapshot-bridge-fallback:bridge-selector-lookup" \
  "$bridge_selector_lookup_matches" \
  "${KB_SNAPSHOT_BRIDGE_SELECTOR_LOOKUP_ALLOWLIST[@]}"

bridge_fallback_matches="$(rg -n -S \
  "kbSnapshot\\?\\.bridgeProjectId|kbSnapshot\\.bridgeProjectId" \
  wren-ui/src/apollo/server/context \
  wren-ui/src/apollo/server/utils || true)"

check_allowlisted_matches \
  "scan-kb-snapshot-bridge-fallback:runtime-fallback-surfaces" \
  "$bridge_fallback_matches" \
  "${KB_SNAPSHOT_BRIDGE_FALLBACK_ALLOWLIST[@]}"

echo "scan-kb-snapshot-bridge-fallback: audit guardrails passed"
