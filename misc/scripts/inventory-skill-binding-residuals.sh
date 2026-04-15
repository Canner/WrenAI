#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

PATTERN='skill_binding|skill binding|skillBindings\b|/api/v1/skills/bindings|buildSkillBindingTestApiUrl|SkillBindingRepository|skillBindingRepository|ISkillBindingRepository|\bSkillBinding\b|migrate_skill_bindings_to_runtime_skills'

count_matches() {
  local matches="$1"
  if [[ -z "$matches" ]]; then
    echo 0
    return 0
  fi

  printf '%s\n' "$matches" | sed '/^$/d' | wc -l | tr -d ' '
}

print_sample_files() {
  local matches="$1"
  if [[ -z "$matches" ]]; then
    echo "sample-files: none"
    return 0
  fi

  echo "sample-files:"
  printf '%s\n' "$matches" \
    | sed '/^$/d' \
    | cut -d: -f1 \
    | sed 's#^\./##' \
    | awk '!seen[$0]++' \
    | head -n 10 \
    | while IFS= read -r file_path; do
        [[ -z "$file_path" ]] && continue
        echo "- $file_path"
      done
}

print_exact_matches_if_small() {
  local matches="$1"
  local match_count
  match_count="$(count_matches "$matches")"

  if [[ "$match_count" -eq 0 || "$match_count" -gt 20 ]]; then
    return 0
  fi

  echo
  echo "exact-matches:"
  printf '%s\n' "$matches" | sed '/^$/d' | sed 's#^\./##' | awk '{ printf("- %s\n", $0) }'
}

runtime_matches="$(
  rg -n --hidden "$PATTERN" wren-ui/src wren-ai-service/src \
    -g '!**/node_modules/**' \
    -g '!**/.git/**' \
    -g '!**/.next/**' \
    -g '!**/.omx/**' \
    -g '!**/.omc/**' \
    -g '!**/.playwright-mcp/**' \
    -g '!**/*.snap' || true
)"

migration_matches="$(
  rg -n --hidden "$PATTERN" wren-ui/migrations \
    -g '!**/*.snap' || true
)"

operations_matches="$(
  rg -n --hidden "$PATTERN" \
    wren-ui/scripts \
    misc/sql \
    misc/scripts/check-skill-binding-main-path.sh \
    -g '!**/*.snap' || true
)"

docs_matches="$(
  rg -n --hidden "$PATTERN" docs \
    -g '!**/*.snap' || true
)"

generated_on="$(date +%F)"

{
cat <<MARKDOWN
# Skill binding retirement inventory (${generated_on})

## Summary

- Runtime / main-path code should no longer depend on legacy \`skill_binding\`.
- Remaining references should be limited to historical migrations, backfill / audit assets, and archival design docs.
- Refresh with: \`bash misc/scripts/inventory-skill-binding-residuals.sh > docs/skill-binding-retirement-inventory.md\`
- Guardrail with: \`bash misc/scripts/check-skill-binding-main-path.sh\`
- SQL readiness audit: \`misc/sql/skill-binding-retirement-readiness.sql\`

## active runtime / main-path code
hit-count: $(count_matches "$runtime_matches")
$(print_sample_files "$runtime_matches")
$(print_exact_matches_if_small "$runtime_matches")

## historical schema migrations
hit-count: $(count_matches "$migration_matches")
$(print_sample_files "$migration_matches")
$(print_exact_matches_if_small "$migration_matches")

## backfill / audit operations
hit-count: $(count_matches "$operations_matches")
$(print_sample_files "$operations_matches")
$(print_exact_matches_if_small "$operations_matches")

## docs / archival plans
hit-count: $(count_matches "$docs_matches")
$(print_sample_files "$docs_matches")

## Notes

- **active runtime / main-path code** should stay at **0**. Any new hit there is a regression.
- **historical schema migrations** are expected to remain in git history; final table retirement should happen via a new drop migration instead of deleting old migration files.
- **backfill / audit operations** remain intentional until the legacy table is fully retired and the final PostgreSQL cutover has been rehearsed.
- **docs / archival plans** may continue to mention legacy bindings for historical context, but should not describe them as the current main path.
MARKDOWN
} | awk '
  BEGIN { previous_blank = 0 }
  /^$/ {
    if (previous_blank) {
      next
    }
    previous_blank = 1
    print
    next
  }
  {
    previous_blank = 0
    print
  }
'
