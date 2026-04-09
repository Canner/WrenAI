#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

PATTERN='sqlite|SQLite|sqlite3|SQLITE_FILE|better-sqlite3'
GENERATED_ON="$(date +%F)"
ALLOWLIST_FILE="misc/sqlite-residual-allowlist.txt"
TARGET_PATHS=(
  ".gitignore"
  ".claude"
  "docs"
  "docker"
  "misc"
  "deployment"
  "wren-ui"
  "wren-ai-service"
  "wren-engine/ibis-server/poetry.lock"
  "wren-launcher/go.sum"
)
ACTIVE_TARGET_PATHS=(
  ".claude"
  "docs"
  "docker"
  "misc"
  "deployment"
  "wren-ui"
  "wren-ai-service"
)
METADATA_PATHS=(
  ".gitignore"
  "wren-ui/.dockerignore"
  "wren-ui/yarn.lock"
  "wren-ai-service/poetry.lock"
  "wren-engine/ibis-server/poetry.lock"
  "wren-launcher/go.sum"
)

existing_targets=()
for path in "${TARGET_PATHS[@]}"; do
  if [[ -e "$path" ]]; then
    existing_targets+=("$path")
  fi
done

existing_active_targets=()
for path in "${ACTIVE_TARGET_PATHS[@]}"; do
  if [[ -e "$path" ]]; then
    existing_active_targets+=("$path")
  fi
done

existing_metadata_paths=()
for path in "${METADATA_PATHS[@]}"; do
  if [[ -e "$path" ]]; then
    existing_metadata_paths+=("$path")
  fi
done

print_section() {
  local title="$1"
  local matches="$2"

  echo "## ${title}"
  if [[ -z "$matches" ]]; then
    echo "hit-count: 0"
    echo "sample-files: none"
    echo
    return
  fi

  local count
  count="$(printf '%s\n' "$matches" | sed '/^$/d' | wc -l | tr -d ' ')"
  echo "hit-count: ${count}"
  echo "sample-files:"
  printf '%s\n' "$matches" | sed '/^$/d' | cut -d: -f1 | uniq | sed 's/^/- /' | sed -n '1,20p'
  if [[ "$count" -le 20 ]]; then
    echo "exact-matches:"
    printf '%s\n' "$matches" | sed '/^$/d' | sed 's/^/- /'
  fi
  echo
}

active_matches="$(
  rg -n --hidden "$PATTERN" "${existing_active_targets[@]}" \
    -g '!**/node_modules/**' \
    -g '!**/.git/**' \
    -g '!**/.next/**' \
    -g '!**/.omx/**' \
    -g '!**/.omc/**' \
    -g '!**/.playwright-mcp/**' \
    -g '!wren-ai-service/tools/dev/etc/**' \
    -g '!wren-ui/.yarn/**' \
    -g '!misc/scripts/check-sqlite-residuals.sh' \
    -g '!misc/scripts/inventory-sqlite-residuals.sh' \
    -g '!misc/sqlite-residual-allowlist.txt' \
    -g '!docs/sqlite-residual-inventory.md' \
    -g '!docs/eval-sqlite-exception-assessment.md' \
    -g '!wren-ai-service/tools/eval_postgres_loader_smoke.py' \
    -g '!wren-ai-service/eval/**' \
    -g '!wren-ai-service/tests/pytest/eval/**' \
    -g '!wren-ui/.dockerignore' \
    -g '!wren-ui/yarn.lock' \
    -g '!wren-ai-service/poetry.lock' || true
)"

eval_matches="$(
  rg -n "$PATTERN" \
    wren-ai-service/eval \
    wren-ai-service/tests/pytest/eval \
    wren-ai-service/tools/eval_postgres_loader_smoke.py || true
)"

metadata_matches="$(
  rg -n --hidden "$PATTERN" "${existing_metadata_paths[@]}" || true
)"

cat <<MARKDOWN
# SQLite residual inventory (${GENERATED_ON})

## Summary

- Product/runtime/dev path should be PostgreSQL-first.
- Remaining SQLite references are expected only in benchmark/eval tooling or repo/dependency metadata.
- Refresh with: \`bash misc/scripts/inventory-sqlite-residuals.sh > docs/sqlite-residual-inventory.md\`
- Guardrail with: \`bash misc/scripts/check-sqlite-residuals.sh\`
- Allowlist source: \`${ALLOWLIST_FILE}\`

MARKDOWN

print_section "active runtime / dev / ops path" "$active_matches"
print_section "benchmark / eval tooling" "$eval_matches"
print_section "repo / dependency metadata" "$metadata_matches"

cat <<'MARKDOWN'
## Notes

- Active runtime/dev/ops hits should stay at **0** after the PostgreSQL cutover.
- Eval hits are currently intentional: the Spider/BIRD benchmark artifacts and helper code still consume upstream SQLite datasets.
- Repo/dependency metadata hits come from ignore files, lockfiles, or upstream package/go checksum records and are not active runtime behavior.
MARKDOWN
