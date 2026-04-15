#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

if ! command -v yarn >/dev/null 2>&1; then
  echo "yarn is required"
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "node is required"
  exit 1
fi

echo "skill-binding-retirement-local-verify: check main-path guardrail"
bash misc/scripts/check-skill-binding-main-path.sh

echo "skill-binding-retirement-local-verify: ensure legacy bindings route directory is absent"
if [[ -e "wren-ui/src/pages/api/v1/skills/bindings" ]]; then
  echo "legacy bindings route directory still exists: wren-ui/src/pages/api/v1/skills/bindings"
  exit 1
fi

echo "skill-binding-retirement-local-verify: refresh inventory"
bash misc/scripts/inventory-skill-binding-residuals.sh > docs/skill-binding-retirement-inventory.md

echo "skill-binding-retirement-local-verify: shell syntax"
bash -n \
  misc/scripts/inventory-skill-binding-residuals.sh \
  misc/scripts/skill-binding-retirement-audit.sh \
  misc/scripts/skill-binding-retirement-rehearsal.sh \
  misc/scripts/skill-binding-retirement-apply.sh \
  misc/scripts/skill-binding-retirement-local-verify.sh

echo "skill-binding-retirement-local-verify: node syntax"
node -c wren-ui/migrations/20260410122000_drop_legacy_skill_binding.js

pushd wren-ui >/dev/null
./node_modules/.bin/prettier --write ../docs/skill-binding-retirement-inventory.md >/dev/null

echo "skill-binding-retirement-local-verify: migration gate tests"
yarn test tests/migrations/20260410122000_drop_legacy_skill_binding.test.js --runInBand

echo "skill-binding-retirement-local-verify: backfill script tests"
yarn test scripts/migrate_skill_bindings_to_runtime_skills.test.ts --runInBand

echo "skill-binding-retirement-local-verify: API regression tests"
yarn test src/pages/api/tests/skills_api.test.ts src/pages/api/tests/graphql.test.ts --runInBand

echo "skill-binding-retirement-local-verify: prettier"
./node_modules/.bin/prettier --check \
  migrations/20260410122000_drop_legacy_skill_binding.js \
  tests/migrations/20260410122000_drop_legacy_skill_binding.test.js \
  scripts/migrate_skill_bindings_to_runtime_skills.test.ts \
  ../docs/skill-binding-retirement-checklist.md \
  ../docs/skill-binding-retirement-inventory.md
popd >/dev/null

echo "skill-binding-retirement-local-verify: pass"
