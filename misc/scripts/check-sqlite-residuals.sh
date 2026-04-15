#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

PATTERN='sqlite|SQLite|sqlite3|SQLITE_FILE|better-sqlite3'
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

existing_targets=()
for path in "${TARGET_PATHS[@]}"; do
  if [[ -e "$path" ]]; then
    existing_targets+=("$path")
  fi
done

if [[ ! -f "$ALLOWLIST_FILE" ]]; then
  echo "allowlist file not found: $ALLOWLIST_FILE"
  exit 1
fi

matches="$(
  rg -n --hidden "$PATTERN" "${existing_targets[@]}" \
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
    -g '!docs/sqlite-residual-inventory.md' || true
)"

if [[ -z "$matches" ]]; then
  echo "check-sqlite-residuals: no SQLite residuals found"
  exit 0
fi

unexpected_matches=""

while IFS= read -r line; do
  [[ -z "$line" ]] && continue
  file_path="${line%%:*}"
  file_path="${file_path#./}"
  if ! grep -Fxq "$file_path" "$ALLOWLIST_FILE"; then
    unexpected_matches+="${line}"$'\n'
  fi
done <<<"$matches"

if [[ -n "$unexpected_matches" ]]; then
  echo "check-sqlite-residuals: unexpected SQLite references found outside allowlist"
  printf '%s' "$unexpected_matches"
  exit 1
fi

allowed_count="$(printf '%s\n' "$matches" | sed '/^$/d' | wc -l | tr -d ' ')"
allowlist_count="$(
  sed '/^\s*#/d;/^\s*$/d' "$ALLOWLIST_FILE" | wc -l | tr -d ' '
)"

echo "check-sqlite-residuals: pass"
echo "allowlisted-hit-count: ${allowed_count}"
echo "allowlisted-file-count: ${allowlist_count}"
