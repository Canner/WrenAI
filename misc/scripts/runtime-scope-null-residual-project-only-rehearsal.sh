#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

SOURCE_PROJECT_ID="${1:-${SOURCE_PROJECT_ID:-}}"
TARGET_WORKSPACE_ID="${2:-${TARGET_WORKSPACE_ID:-}}"
TARGET_KNOWLEDGE_BASE_ID="${3:-${TARGET_KNOWLEDGE_BASE_ID:-}}"
TARGET_KB_SNAPSHOT_ID="${4:-${TARGET_KB_SNAPSHOT_ID:-}}"
TARGET_DEPLOY_HASH="${5:-${TARGET_DEPLOY_HASH:-}}"
PG_URL="${6:-${PG_URL:-}}"

AUDIT_SQL="${ROOT_DIR}/misc/sql/runtime-scope-null-residual-audit.sql"
BACKFILL_SQL="${ROOT_DIR}/misc/sql/runtime-scope-null-residual-project-only-backfill.sql"
COMPOSE_FILE="${COMPOSE_FILE:-${ROOT_DIR}/docker/docker-compose.yaml}"
POSTGRES_SERVICE="${POSTGRES_SERVICE:-postgres}"
POSTGRES_USER="${POSTGRES_USER:-postgres}"
POSTGRES_DB="${POSTGRES_DB:-wrenai}"

usage() {
  cat <<EOF
usage:
  bash misc/scripts/runtime-scope-null-residual-project-only-rehearsal.sh \\
    <source_project_id> <workspace_id> <knowledge_base_id> <kb_snapshot_id> <deploy_hash> [postgres-connection-url]

notes:
  - If local psql is unavailable, the script falls back to:
      docker compose -f docker/docker-compose.yaml exec -T postgres psql ...
  - This script wraps the manual project-only backfill in a transaction and rolls back at the end.
EOF
}

if [[ -z "$SOURCE_PROJECT_ID" || -z "$TARGET_WORKSPACE_ID" || -z "$TARGET_KNOWLEDGE_BASE_ID" || -z "$TARGET_KB_SNAPSHOT_ID" || -z "$TARGET_DEPLOY_HASH" ]]; then
  usage
  exit 1
fi

if [[ ! -f "$AUDIT_SQL" ]]; then
  echo "audit SQL file not found: $AUDIT_SQL"
  exit 1
fi

if [[ ! -f "$BACKFILL_SQL" ]]; then
  echo "backfill SQL file not found: $BACKFILL_SQL"
  exit 1
fi

USE_LOCAL_PSQL=0
if [[ -n "$PG_URL" ]] && command -v psql >/dev/null 2>&1; then
  USE_LOCAL_PSQL=1
fi

run_psql_file() {
  local sql_file="$1"
  shift
  local extra_args=("$@")
  if [[ "$USE_LOCAL_PSQL" == "1" ]]; then
    if ((${#extra_args[@]})); then
      psql "$PG_URL" -v ON_ERROR_STOP=1 "${extra_args[@]}" -f "$sql_file"
    else
      psql "$PG_URL" -v ON_ERROR_STOP=1 -f "$sql_file"
    fi
    return
  fi

  if ! command -v docker >/dev/null 2>&1; then
    echo "psql is unavailable and docker is not installed"
    exit 1
  fi

  if ((${#extra_args[@]})); then
    docker compose -f "$COMPOSE_FILE" exec -T "$POSTGRES_SERVICE" \
      psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 "${extra_args[@]}" -f - < "$sql_file"
  else
    docker compose -f "$COMPOSE_FILE" exec -T "$POSTGRES_SERVICE" \
      psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -f - < "$sql_file"
  fi
}

echo "runtime-scope-null-residual-project-only-rehearsal: source_project_id=${SOURCE_PROJECT_ID}"
echo "runtime-scope-null-residual-project-only-rehearsal: target_scope=${TARGET_WORKSPACE_ID}/${TARGET_KNOWLEDGE_BASE_ID}/${TARGET_KB_SNAPSHOT_ID}/${TARGET_DEPLOY_HASH}"
if [[ "$USE_LOCAL_PSQL" == "1" ]]; then
  echo "runtime-scope-null-residual-project-only-rehearsal: transport=local-psql"
else
  echo "runtime-scope-null-residual-project-only-rehearsal: transport=docker-compose:${POSTGRES_SERVICE}"
fi

TMP_SQL="$(mktemp "${TMPDIR:-/tmp}/runtime-scope-null-project-only-rehearsal.XXXXXX.sql")"
cleanup() {
  rm -f "$TMP_SQL"
}
trap cleanup EXIT

{
  cat <<SQL
BEGIN;
\echo '== before-backfill =='
SQL
  cat "$AUDIT_SQL"
  cat <<SQL
\echo '== applying-project-only-backfill =='
\set source_project_id ${SOURCE_PROJECT_ID}
\set target_workspace_id ${TARGET_WORKSPACE_ID}
\set target_knowledge_base_id ${TARGET_KNOWLEDGE_BASE_ID}
\set target_kb_snapshot_id ${TARGET_KB_SNAPSHOT_ID}
\set target_deploy_hash ${TARGET_DEPLOY_HASH}
SQL
  cat "$BACKFILL_SQL"
  cat <<SQL
\echo '== after-backfill =='
SQL
  cat "$AUDIT_SQL"
  cat <<'SQL'
ROLLBACK;
SQL
} > "$TMP_SQL"

run_psql_file "$TMP_SQL"

echo "runtime-scope-null-residual-project-only-rehearsal: pass"
