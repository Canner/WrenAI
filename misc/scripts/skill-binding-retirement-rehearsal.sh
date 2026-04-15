#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

PG_URL="${1:-${PG_URL:-}}"
WORKSPACE_ID="${2:-${SKILL_BINDING_WORKSPACE_ID:-}}"

if [[ -z "$PG_URL" ]]; then
  echo "usage: bash misc/scripts/skill-binding-retirement-rehearsal.sh <postgres-connection-url> [workspace-id]"
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "psql is required"
  exit 1
fi

if ! command -v yarn >/dev/null 2>&1; then
  echo "yarn is required"
  exit 1
fi

echo "skill-binding-retirement-rehearsal: pg-url=${PG_URL}"
echo "skill-binding-retirement-rehearsal: mode=preflight-dry-run"
if [[ -n "$WORKSPACE_ID" ]]; then
  echo "skill-binding-retirement-rehearsal: workspace-scope=${WORKSPACE_ID}"
fi

bash misc/scripts/skill-binding-retirement-audit.sh "$PG_URL"

pushd wren-ui >/dev/null
if [[ -n "$WORKSPACE_ID" ]]; then
  PG_URL="$PG_URL" yarn ts-node --compiler-options '{"module":"commonjs"}' scripts/migrate_skill_bindings_to_runtime_skills.ts --dry-run --workspace-id "$WORKSPACE_ID"
else
  PG_URL="$PG_URL" yarn ts-node --compiler-options '{"module":"commonjs"}' scripts/migrate_skill_bindings_to_runtime_skills.ts --dry-run
fi
popd >/dev/null

echo "skill-binding-retirement-rehearsal: pass"
echo "note: this script is non-mutating; it does not execute the backfill or apply the drop migration."
