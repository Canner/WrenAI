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
BACKUP_DIR="${ROOT_DIR}/tmp/runtime-scope-backups"
TIMESTAMP="$(date +%Y%m%d%H%M%S)"
BACKUP_PATH="${BACKUP_DIR}/runtime-scope-null-project-only.${TIMESTAMP}.dump"

usage() {
  cat <<EOF
usage:
  bash misc/scripts/runtime-scope-null-residual-project-only-apply.sh \\
    <source_project_id> <workspace_id> <knowledge_base_id> <kb_snapshot_id> <deploy_hash> [postgres-connection-url]

notes:
  - If local psql/pg_dump are unavailable, the script falls back to:
      docker compose -f docker/docker-compose.yaml exec -T postgres psql/pg_dump ...
  - This script creates a backup before applying the manual project-only backfill.
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
USE_LOCAL_PG_DUMP=0
if [[ -n "$PG_URL" ]] && command -v psql >/dev/null 2>&1; then
  USE_LOCAL_PSQL=1
fi
if [[ -n "$PG_URL" ]] && command -v pg_dump >/dev/null 2>&1; then
  USE_LOCAL_PG_DUMP=1
fi

ensure_docker_available() {
  if ! command -v docker >/dev/null 2>&1; then
    echo "local postgres tools are unavailable and docker is not installed"
    exit 1
  fi
}

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

  ensure_docker_available
  if ((${#extra_args[@]})); then
    docker compose -f "$COMPOSE_FILE" exec -T "$POSTGRES_SERVICE" \
      psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 "${extra_args[@]}" -f - < "$sql_file"
  else
    docker compose -f "$COMPOSE_FILE" exec -T "$POSTGRES_SERVICE" \
      psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -f - < "$sql_file"
  fi
}

run_pg_dump_to_file() {
  local output_path="$1"

  if [[ "$USE_LOCAL_PG_DUMP" == "1" ]]; then
    pg_dump "$PG_URL" --format=custom --file="$output_path" >/dev/null
    return
  fi

  ensure_docker_available
  docker compose -f "$COMPOSE_FILE" exec -T "$POSTGRES_SERVICE" \
    pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc > "$output_path"
}

mkdir -p "$BACKUP_DIR"
run_pg_dump_to_file "$BACKUP_PATH"

echo "runtime-scope-null-residual-project-only-apply: source_project_id=${SOURCE_PROJECT_ID}"
echo "runtime-scope-null-residual-project-only-apply: target_scope=${TARGET_WORKSPACE_ID}/${TARGET_KNOWLEDGE_BASE_ID}/${TARGET_KB_SNAPSHOT_ID}/${TARGET_DEPLOY_HASH}"
echo "runtime-scope-null-residual-project-only-apply: backup=${BACKUP_PATH}"
if [[ "$USE_LOCAL_PSQL" == "1" ]]; then
  echo "runtime-scope-null-residual-project-only-apply: transport=local-psql"
else
  echo "runtime-scope-null-residual-project-only-apply: transport=docker-compose:${POSTGRES_SERVICE}"
fi

echo "== before-backfill =="
run_psql_file "$AUDIT_SQL"

run_psql_file \
  "$BACKFILL_SQL" \
  -v "source_project_id=${SOURCE_PROJECT_ID}" \
  -v "target_workspace_id=${TARGET_WORKSPACE_ID}" \
  -v "target_knowledge_base_id=${TARGET_KNOWLEDGE_BASE_ID}" \
  -v "target_kb_snapshot_id=${TARGET_KB_SNAPSHOT_ID}" \
  -v "target_deploy_hash=${TARGET_DEPLOY_HASH}"

echo "== after-backfill =="
run_psql_file "$AUDIT_SQL"

echo "runtime-scope-null-residual-project-only-apply: pass"
