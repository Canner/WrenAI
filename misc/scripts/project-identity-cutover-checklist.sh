#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

COMPATIBILITY_BOUNDARY_FILE="misc/project-identity-compatibility-boundaries.tsv"
MATCH_PATTERN='legacyProjectId|legacy_project_id|projectBridgeId|project_bridge_id'

count_matches() {
  local matches="$1"
  if [[ -z "$matches" ]]; then
    echo 0
    return 0
  fi

  printf '%s\n' "$matches" | sed '/^$/d' | wc -l | tr -d ' '
}

wave_for_path() {
  case "$1" in
    wren-ai-service/src/core/runtime_identity.py|wren-ai-service/src/web/v1/services/__init__.py)
      echo "Wave 1 — AI service request alias cutover"
      ;;
    wren-ui/src/runtime/client/runtimeScope.ts)
      echo "Wave 2 — frontend query alias cutover"
      ;;
    wren-ui/src/apollo/server/repositories/kbSnapshotRepository.ts)
      echo "Wave 3 — persisted kb snapshot storage cutover"
      ;;
    *)
      echo "Unclassified"
      ;;
  esac
}

prerequisite_for_path() {
  case "$1" in
    wren-ai-service/src/core/runtime_identity.py)
      echo "All callers stop sending projectBridgeId/project_bridge_id, and bridgeScopeId or canonical runtime_identity fields cover the same flows."
      ;;
    wren-ai-service/src/web/v1/services/__init__.py)
      echo "External clients are cut over to runtime_scope_id / runtimeScopeId or canonical runtimeIdentity fields; request bodies no longer rely on projectBridgeId/project_bridge_id."
      ;;
    wren-ui/src/runtime/client/runtimeScope.ts)
      echo "Old bookmarked links, copied URLs, and internal route builders no longer rely on legacyProjectId/legacy_project_id query params."
      ;;
    wren-ui/src/apollo/server/repositories/kbSnapshotRepository.ts)
      echo "Persisted kb_snapshot rows no longer rely on legacy_project_id, dashboard / kb_snapshot deploy-hash drift has been backfilled (see migration 20260409153000_backfill_dashboard_and_kb_snapshot_runtime_binding.js), legacy_project_id rows have been cleared (see migration 20260409170000_clear_kb_snapshot_legacy_project_id.js), and the Wave 3 audit in docs/project-identity-kb-snapshot-wave3-audit.md is satisfied."
      ;;
    *)
      echo "Review boundary ownership before removal."
      ;;
  esac
}

rollback_for_path() {
  case "$1" in
    wren-ai-service/src/core/runtime_identity.py|wren-ai-service/src/web/v1/services/__init__.py)
      echo "Restore legacy alias acceptance plus deprecation warnings, then rerun the AI service runtime identity tests."
      ;;
    wren-ui/src/runtime/client/runtimeScope.ts)
      echo "Restore legacy query alias parsing and warning behavior so old links continue to hydrate runtime scope."
      ;;
    wren-ui/src/apollo/server/repositories/kbSnapshotRepository.ts)
      echo "Restore the legacyProjectId storage mapping (or equivalent fallback) before reading older kb_snapshot rows again."
      ;;
    *)
      echo "Revert the boundary-specific deletion and rerun the repo-wide inventory scripts."
      ;;
  esac
}

wave_description_for_path() {
  case "$1" in
    wren-ai-service/src/core/runtime_identity.py|wren-ai-service/src/web/v1/services/__init__.py)
      echo "Remove AI service legacy request alias acceptance once all callers are off projectBridgeId/project_bridge_id."
      ;;
    wren-ui/src/runtime/client/runtimeScope.ts)
      echo "Remove legacy query parsing after old bookmarked links and copied URLs are retired."
      ;;
    wren-ui/src/apollo/server/repositories/kbSnapshotRepository.ts)
      echo "Remove the legacy persisted key mapping only after stored rows are migrated or otherwise proven clean."
      ;;
    *)
      echo "Review the remaining compatibility boundary and remove it in a dedicated cutover step."
      ;;
  esac
}

print_pending_wave_order() {
  local seen_waves=""
  local order=1

  while IFS=$'\t' read -r path _boundary_kind _cutover_action; do
    [[ -z "$path" || "$path" =~ ^# ]] && continue
    local wave
    wave="$(wave_for_path "$path")"

    if printf '%s' "$seen_waves" | grep -Fqx "$wave"; then
      continue
    fi

    seen_waves+="${wave}"$'\n'
    echo "${order}. **${wave}**"
    echo "   - $(wave_description_for_path "$path")"
    order=$((order + 1))
  done < "$COMPATIBILITY_BOUNDARY_FILE"

  if [[ "$order" == "1" ]]; then
    echo "- None. Compatibility boundary cutover is complete."
  fi
}

print_verification_commands() {
  local path="$1"

  cat <<'MARKDOWN'
- `bash misc/scripts/scan-runtime-identity.sh`
- `bash misc/scripts/inventory-project-identity.sh`
MARKDOWN

  case "$path" in
    wren-ai-service/src/core/runtime_identity.py|wren-ai-service/src/web/v1/services/__init__.py)
      cat <<'MARKDOWN'
- `cd wren-ai-service && poetry run pytest tests/pytest/core/test_runtime_identity.py tests/pytest/services/test_runtime_identity_bridge.py -q`
MARKDOWN
      ;;
    wren-ui/src/runtime/client/runtimeScope.ts)
      cat <<'MARKDOWN'
- `cd wren-ui && npx eslint src/runtime/client/runtimeScope.ts src/runtime/client/tests/runtimeScope.test.ts`
- `cd wren-ui && yarn jest src/runtime/client/tests/runtimeScope.test.ts --runInBand`
MARKDOWN
      ;;
    wren-ui/src/apollo/server/repositories/kbSnapshotRepository.ts)
      cat <<'MARKDOWN'
- `bash misc/scripts/scan-kb-snapshot-bridge-fallback.sh`
- Run `misc/sql/project-identity-kb-snapshot-wave3-audit.sql` against the real app database
- Optional PostgreSQL rehearsal (runs inside a transaction and rolls back): `bash misc/scripts/project-identity-kb-snapshot-backfill-rehearsal.sh "$PG_URL"`
- Optional PostgreSQL apply path (creates \`pg_dump\` backup first): `bash misc/scripts/project-identity-kb-snapshot-backfill-apply.sh "$PG_URL"`
- Optional PostgreSQL final drop path (creates \`pg_dump\` backup first): `bash misc/scripts/project-identity-kb-snapshot-drop-legacy-column.sh "$PG_URL"`
- Ensure `wren-ui/migrations/20260409170000_clear_kb_snapshot_legacy_project_id.js` has been applied before removing the final mapping
- Ensure `wren-ui/migrations/20260409153000_backfill_dashboard_and_kb_snapshot_runtime_binding.js` has been applied before removing the final mapping
- `cd wren-ui && yarn jest src/apollo/server/repositories/kbSnapshotRepository.test.ts --runInBand`
MARKDOWN
      ;;
  esac
}

print_boundary_section() {
  local index="$1"
  local path="$2"
  local boundary_kind="$3"
  local cutover_action="$4"

  local matches
  matches="$(rg -n -S "$MATCH_PATTERN" "$path" || true)"

  local count
  count="$(count_matches "$matches")"

  cat <<MARKDOWN
## ${index}. \`${path}\`

- **Boundary kind:** \`${boundary_kind}\`
- **Suggested wave:** $(wave_for_path "$path")
- **Current exact-match hit count:** ${count}
- **Cutover action:** ${cutover_action}
- **Prerequisite:** $(prerequisite_for_path "$path")
- **Rollback:** $(rollback_for_path "$path")

### Current exact matches
MARKDOWN

  if [[ "$count" == "0" ]]; then
    echo "- None. If this is unexpected, rerun the inventory script and review the allowlist TSV."
  else
    printf '%s\n' "$matches" | awk '{ printf("- `%s`\n", $0) }'
  fi

  echo
  echo "### Verification"
  print_verification_commands "$path"
  echo
}

remaining_hit_matches="$(
  rg -n -S "$MATCH_PATTERN" \
    wren-ui/src wren-ai-service/src \
    --glob '!**/tests/**' \
    --glob '!**/*.test.*' || true
)"
remaining_hit_count="$(count_matches "$remaining_hit_matches")"
remaining_boundary_count="$(awk -F '\t' 'NF > 0 && $1 !~ /^#/' "$COMPATIBILITY_BOUNDARY_FILE" | wc -l | tr -d ' ')"

generated_on="$(date +%F)"

cat <<MARKDOWN
# Project identity compatibility cutover checklist (${generated_on})

> Generated from \`${COMPATIBILITY_BOUNDARY_FILE}\`.
> Refresh with: \`bash misc/scripts/project-identity-cutover-checklist.sh > docs/project-identity-cutover-checklist.md\`

## Current cutover baseline

- Safe, non-breaking cleanup is complete; the remaining work is **breaking-change cutover**.
- Remaining compatibility-boundary files: **${remaining_boundary_count}**
- Remaining implementation exact-match hits for legacy bridge aliases: **${remaining_hit_count}**
- Repo-wide baseline commands:
  - \`bash misc/scripts/scan-runtime-identity.sh\`
  - \`bash misc/scripts/inventory-project-identity.sh\`

## Recommended cutover order

$(print_pending_wave_order)

## Boundary checklist
MARKDOWN

index=1
while IFS=$'\t' read -r path boundary_kind cutover_action; do
  [[ -z "$path" || "$path" =~ ^# ]] && continue
  print_boundary_section "$index" "$path" "$boundary_kind" "$cutover_action"
  index=$((index + 1))
done < "$COMPATIBILITY_BOUNDARY_FILE"

cat <<'MARKDOWN'
## Execution notes

- Treat each boundary as an explicit breaking-change step; do not batch all four removals blindly.
- Refresh this checklist immediately before starting a cutover wave so the exact-match lines stay current.
- If any wave fails verification, roll back that boundary before moving to the next one.
MARKDOWN
