#!/usr/bin/env bash
# E2E test for the `wren genbi` command group.
#
# Installs the local CLI into the project venv (uv sync) and exercises the
# real `wren` binary end-to-end against a throwaway project. Grows one
# section per slice. Run from core/wren:
#
#   ./scripts/genbi-e2e.sh
set -euo pipefail

cd "$(dirname "$0")/.."

PASS=0
FAIL=0

ok()   { PASS=$((PASS + 1)); echo "  ✅ $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  ❌ $1"; }

assert_contains() { # haystack-file needle label
  if grep -qF -- "$2" "$1"; then ok "$3"; else fail "$3 (missing: $2)"; fi
}

assert_not_exists() { # path label
  if [ ! -e "$1" ]; then ok "$2"; else fail "$2 (unexpected: $1)"; fi
}

# ── Install local CLI ───────────────────────────────────────────────────────
echo "── installing local CLI (uv sync --extra dev)"
uv sync --extra dev --quiet
WREN="uv run wren"
$WREN --help > /dev/null || { echo "FATAL: wren CLI not runnable"; exit 1; }
echo "  ✅ wren CLI installed and runnable"

# ── Fixture project ─────────────────────────────────────────────────────────
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
PROJECT="$WORK/proj"
mkdir -p "$PROJECT/models/orders"

cat > "$PROJECT/wren_project.yml" << 'YML'
schema_version: 2
name: e2e_proj
version: "1.0"
catalog: wren
schema: public
data_source: duckdb
YML

cat > "$PROJECT/models/orders/metadata.yml" << 'YML'
name: orders
table_reference:
  catalog: ""
  schema: public
  table: orders
columns:
  - name: id
    type: INTEGER
    is_calculated: false
    not_null: true
    properties: {}
  - name: total
    type: DECIMAL
    is_calculated: false
    not_null: false
    properties: {}
primary_key: id
cached: false
properties:
  description: Orders table
YML

echo "relationships: []" > "$PROJECT/relationships.yml"

# ════════════════════════════════════════════════════════════════════════════
# Slice 01 — `wren genbi build` returns a hydrated instruction, writes nothing
# ════════════════════════════════════════════════════════════════════════════
echo "── slice 01: genbi build"

OUT="$WORK/build.out"
$WREN genbi build myapp --prompt "show revenue by month" -p "$PROJECT" > "$OUT" 2> "$WORK/build.err"

assert_contains "$OUT" "target/mdl.json" "instruction points at compiled MDL"
assert_contains "$OUT" "apps/myapp" "instruction names the target folder"
assert_contains "$OUT" "show revenue by month" "user prompt passed through verbatim"
assert_contains "$OUT" "orders" "model inventory present"
assert_contains "$OUT" "wren-core-wasm" "wasm wiring present"
assert_contains "$OUT" "CDN" "CDN directive present (no 68MB bundle)"
assert_contains "$OUT" "wren genbi register myapp" "final step: register"
assert_contains "$OUT" "wren genbi verify myapp" "final step: verify"
assert_contains "$OUT" "parquet" "snapshot data guidance present"
assert_not_exists "$PROJECT/apps" "build wrote no app files"
assert_not_exists "$PROJECT/.wren/apps.yml" "build wrote no index"

# implicit MDL compile happened (project had no target/ before)
if [ -f "$PROJECT/target/mdl.json" ]; then
  ok "missing MDL was compiled implicitly"
else
  fail "missing MDL was compiled implicitly"
fi

# prompt via stdin
OUT2="$WORK/build-stdin.out"
echo "stdin prompt body" | $WREN genbi build myapp --prompt - -p "$PROJECT" > "$OUT2"
assert_contains "$OUT2" "stdin prompt body" "prompt readable from stdin"

# ════════════════════════════════════════════════════════════════════════════
# Slice 02 — register / list / remove (.wren/apps.yml index)
# ════════════════════════════════════════════════════════════════════════════
echo "── slice 02: register / list / remove"

mkdir -p "$PROJECT/apps/myapp"
echo "<html></html>" > "$PROJECT/apps/myapp/index.html"

$WREN genbi register myapp --data-mode snapshot -p "$PROJECT" > "$WORK/reg.out"
if [ -f "$PROJECT/.wren/apps.yml" ]; then ok "register wrote .wren/apps.yml"; else fail "register wrote .wren/apps.yml"; fi
assert_contains "$PROJECT/.wren/apps.yml" "myapp" "index contains the app"
assert_contains "$PROJECT/.wren/apps.yml" "scaffolded" "status starts as scaffolded"

OUT="$WORK/list.out"
$WREN genbi list -p "$PROJECT" > "$OUT"
assert_contains "$OUT" "myapp" "list shows the app"
assert_contains "$OUT" "snapshot" "list shows the data mode"

if $WREN genbi register ghost -p "$PROJECT" 2> "$WORK/ghost.err"; then
  fail "register rejects a missing app dir"
else
  ok "register rejects a missing app dir"
fi

$WREN genbi remove myapp -p "$PROJECT" > /dev/null
OUT="$WORK/list2.out"
$WREN genbi list -p "$PROJECT" > "$OUT"
assert_contains "$OUT" "No apps" "remove cleared the index"

# re-register for later slices
$WREN genbi register myapp --data-mode snapshot -p "$PROJECT" > /dev/null

# ── Summary ─────────────────────────────────────────────────────────────────
echo
echo "passed: $PASS, failed: $FAIL"
[ "$FAIL" -eq 0 ] || exit 1
