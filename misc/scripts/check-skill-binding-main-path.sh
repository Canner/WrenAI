#!/usr/bin/env bash

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

PATTERN='listSkillBindingsByKnowledgeBase|/api/v1/skills/bindings|skillBindings\b'

TARGETS=(
  "wren-ui/src/apollo/server/utils/askContext.ts"
  "wren-ui/src/apollo/client/graphql/skills.ts"
  "wren-ui/src/pages/home/index.tsx"
  "wren-ui/src/pages/knowledge/skills.tsx"
  "wren-ui/src/pages/api/v1/ask.ts"
  "wren-ui/src/pages/api/v1/generate_sql.ts"
  "wren-ui/src/pages/api/v1/stream/ask.ts"
  "wren-ui/src/pages/api/v1/stream/generate_sql.ts"
  "wren-ui/src/pages/api/v1/skills/index.ts"
  "wren-ui/src/pages/api/v1/skills/available.ts"
  "wren-ui/src/pages/api/v1/skills/[id].ts"
  "wren-ui/src/pages/api/v1/skills/[id]/test.ts"
)

if rg -n -e "$PATTERN" "${TARGETS[@]}"; then
  echo "check-skill-binding-main-path: unexpected legacy skill-binding references found"
  exit 1
fi

echo "check-skill-binding-main-path: pass"
