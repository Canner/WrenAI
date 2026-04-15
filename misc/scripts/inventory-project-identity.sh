#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

COMPATIBILITY_BOUNDARY_FILE="misc/project-identity-compatibility-boundaries.tsv"

count_matches() {
  local matches="$1"
  if [[ -z "$matches" ]]; then
    echo 0
    return 0
  fi
  printf '%s\n' "$matches" | sed '/^$/d' | wc -l | tr -d ' '
}

print_compatibility_boundary_actions() {
  local matches="$1"

  if [[ -z "$matches" ]]; then
    return 0
  fi

  local files
  files="$(printf '%s\n' "$matches" | cut -d: -f1 | sort -u)"

  echo "boundary-actions:"
  while IFS= read -r file; do
    [[ -z "$file" ]] && continue
    local action
    action="$(
      awk -F '\t' -v target="$file" '
        $1 == target { print $3; exit }
      ' "$COMPATIBILITY_BOUNDARY_FILE"
    )"
    if [[ -n "$action" ]]; then
      echo "- $file :: $action"
    else
      echo "- $file :: review and classify before removing"
    fi
  done <<< "$files"
}

print_section() {
  local title="$1"
  local disposition="$2"
  local matches="$3"

  local count
  count="$(count_matches "$matches")"

  echo "## $title [$disposition]"
  echo "hit-count: $count"

  if [[ "$count" == "0" ]]; then
    echo "sample-files: none"
    echo
    return 0
  fi

  echo "sample-files:"
  printf '%s\n' "$matches" | cut -d: -f1 | sort -u | sed -n '1,8p' | sed 's/^/- /'

  if [[ "$count" -le 10 ]]; then
    echo "exact-matches:"
    printf '%s\n' "$matches" | sed 's/^/- /'

    if [[ "$title" == "compatibility bridge / legacy selectors" ]]; then
      print_compatibility_boundary_actions "$matches"
    fi
  fi

  echo
}

echo "== runtime identity baseline =="
bash misc/scripts/scan-runtime-identity.sh

echo
echo "== categorized project identity inventory =="

bridge_matches="$(rg -n -S \
  "legacyProjectId|legacy_project_id|project bridge|projectBridgeId|project_bridge_id|legacy project bridge" \
  wren-ui/src wren-ai-service/src \
  -g '!**/tests/**' -g '!**/*.test.*' || true)"

project_domain_matches="$(rg -n -S \
  "createTable\\('project'|table\\.(integer|string)\\('project_id'|class ProjectService|interface Project|tableName: 'project'|projectResolver" \
  wren-ui/src wren-ui/migrations \
  -g '!**/tests/**' -g '!**/*.test.*' || true)"

external_matches="$(rg -n -S \
  "GCP project id|big query project id|TEST_BIG_QUERY_PROJECT_ID|project_id cannot be empty|name=\"projectId\"|json:\"project_id\"|Field\\(description=\"GCP project id\"" \
  wren-ui wren-engine wren-launcher wren-ai-service \
  -g '!node_modules' -g '!**/tests/**' -g '!**/*.test.*' || true)"

print_section "compatibility bridge / legacy selectors" "shrink-after-cutover" "$bridge_matches"
print_section "project domain / persistence anchors" "keep-for-now" "$project_domain_matches"
print_section "external datasource semantics" "do-not-delete" "$external_matches"

echo "Notes:"
echo "- Counts are rg hit counts, not distinct file counts."
echo "- Docs are intentionally excluded from the categorized scan."
echo "- Most tests are excluded so the output reflects active implementation surfaces."
echo "- When a section drops to 10 or fewer hits, exact remaining matches are printed."
echo "- Compatibility sections at 10 or fewer hits also print per-file cutover guidance."
