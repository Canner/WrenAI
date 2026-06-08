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

# ════════════════════════════════════════════════════════════════════════════
# Slice 03 — verify (preflight) / open (local preview)
# ════════════════════════════════════════════════════════════════════════════
echo "── slice 03: verify / open"

# incomplete app (no mdl.json, no data asset) must fail verify
if $WREN genbi verify myapp -p "$PROJECT" 2> "$WORK/verify1.err"; then
  fail "verify fails an incomplete app"
else
  ok "verify fails an incomplete app"
fi
assert_contains "$WORK/verify1.err" "mdl.json" "failure reason names mdl.json"

# complete the app per the build instruction's conventions
cp "$PROJECT/target/mdl.json" "$PROJECT/apps/myapp/mdl.json"
mkdir -p "$PROJECT/apps/myapp/data"
printf 'PAR1fake' > "$PROJECT/apps/myapp/data/orders.parquet"

$WREN genbi verify myapp -p "$PROJECT" > "$WORK/verify2.out"
assert_contains "$WORK/verify2.out" "Verify passed" "verify passes a complete app"
assert_contains "$PROJECT/.wren/apps.yml" "built" "status flipped to built"

# open: serve in background, curl the page, kill
$WREN genbi open myapp --port 0 -p "$PROJECT" > "$WORK/open.out" 2>&1 &
OPEN_PID=$!
sleep 2
URL="$(grep -oE 'http://127\.0\.0\.1:[0-9]+/' "$WORK/open.out" | head -1 || true)"
if [ -n "$URL" ] && curl -sf "$URL" | grep -q "html"; then
  ok "open serves the app locally ($URL)"
else
  fail "open serves the app locally"
fi
kill "$OPEN_PID" 2>/dev/null || true

# ════════════════════════════════════════════════════════════════════════════
# Slice 04 — deploy → Vercel (error paths only; upload is mocked in pytest)
# ════════════════════════════════════════════════════════════════════════════
echo "── slice 04: deploy (vercel)"

# without a token: actionable error naming the env var, no crash
if env -u VERCEL_TOKEN uv run wren genbi deploy myapp --provider vercel -p "$PROJECT" 2> "$WORK/deploy1.err"; then
  fail "deploy without token errors"
else
  ok "deploy without token errors"
fi
assert_contains "$WORK/deploy1.err" "VERCEL_TOKEN" "error names VERCEL_TOKEN"
assert_contains "$WORK/deploy1.err" "shell history" "error warns against --token flags"

# unknown provider is rejected
if $WREN genbi deploy myapp --provider bogus -p "$PROJECT" 2> "$WORK/deploy2.err"; then
  fail "unknown provider rejected"
else
  ok "unknown provider rejected"
fi

# a broken app is blocked by the verify preflight even with a token present
rm "$PROJECT/apps/myapp/mdl.json"
if VERCEL_TOKEN=fake $WREN genbi deploy myapp --provider vercel -p "$PROJECT" 2> "$WORK/deploy3.err"; then
  fail "deploy aborts when verify fails"
else
  ok "deploy aborts when verify fails"
fi
assert_contains "$WORK/deploy3.err" "verify failed" "abort message mentions verify"
cp "$PROJECT/target/mdl.json" "$PROJECT/apps/myapp/mdl.json"

# ════════════════════════════════════════════════════════════════════════════
# Slice 05 — deploy → Cloudflare (error paths only; upload mocked in pytest)
# ════════════════════════════════════════════════════════════════════════════
echo "── slice 05: deploy (cloudflare)"

if env -u CLOUDFLARE_API_TOKEN uv run wren genbi deploy myapp --provider cloudflare -p "$PROJECT" 2> "$WORK/cf1.err"; then
  fail "cloudflare deploy without token errors"
else
  ok "cloudflare deploy without token errors"
fi
assert_contains "$WORK/cf1.err" "CLOUDFLARE_API_TOKEN" "error names CLOUDFLARE_API_TOKEN"

if env -u CLOUDFLARE_ACCOUNT_ID CLOUDFLARE_API_TOKEN=fake uv run wren genbi deploy myapp --provider cloudflare -p "$PROJECT" 2> "$WORK/cf2.err"; then
  fail "cloudflare deploy without account id errors"
else
  ok "cloudflare deploy without account id errors"
fi
assert_contains "$WORK/cf2.err" "CLOUDFLARE_ACCOUNT_ID" "error names CLOUDFLARE_ACCOUNT_ID"

# ════════════════════════════════════════════════════════════════════════════
# Slice 06 — live data mode + secret-leak security gate
# ════════════════════════════════════════════════════════════════════════════
echo "── slice 06: live mode + secret gate"

OUT="$WORK/live.out"
$WREN genbi build liveapp --prompt "live dashboard" --data-mode live -p "$PROJECT" > "$OUT"
assert_contains "$OUT" "CORS" "live instruction surfaces CORS"
assert_contains "$OUT" "MUST NEVER" "live instruction carries the hard rule"

# live app without data asset passes verify…
mkdir -p "$PROJECT/apps/liveapp"
echo "<html><body>live</body></html>" > "$PROJECT/apps/liveapp/index.html"
cp "$PROJECT/target/mdl.json" "$PROJECT/apps/liveapp/mdl.json"
$WREN genbi register liveapp --data-mode live -p "$PROJECT" > /dev/null
$WREN genbi verify liveapp -p "$PROJECT" > "$WORK/live-verify.out"
assert_contains "$WORK/live-verify.out" "Verify passed" "clean live app passes verify"

# …but an inlined credential is caught by the gate
echo 'const DB = "postgres://admin:s3cretpw@db.internal:5432/prod";' > "$PROJECT/apps/liveapp/config.js"
if $WREN genbi verify liveapp -p "$PROJECT" 2> "$WORK/live-secret.err"; then
  fail "verify blocks an inlined credential"
else
  ok "verify blocks an inlined credential"
fi
assert_contains "$WORK/live-secret.err" "config.js" "failure names the offending file"
assert_contains "$WORK/live-secret.err" "secret" "failure explains the secret risk"

# and deploy refuses to ship it even with a token present
if VERCEL_TOKEN=fake $WREN genbi deploy liveapp --provider vercel -p "$PROJECT" 2> "$WORK/live-deploy.err"; then
  fail "deploy refuses a secret-leaking app"
else
  ok "deploy refuses a secret-leaking app"
fi

# ════════════════════════════════════════════════════════════════════════════
# Slice 07 — companion skill walkthrough (the documented agent workflow)
# ════════════════════════════════════════════════════════════════════════════
echo "── slice 07: skill walkthrough"

# the skill guide is served by the CLI (wren skills get genbi-app), not shipped
# as a standalone skills/ dir — the discovery stub is the only external skill.
$WREN skills get genbi-app > "$WORK/skill.out" 2>&1
assert_contains "$WORK/skill.out" "Wren GenBI App" "skill guide served via 'wren skills get genbi-app'"

# every command in the skill's quick reference exists in the real CLI
HELP="$WORK/genbi-help.out"
$WREN genbi --help > "$HELP" 2>&1
for cmd in build register verify open deploy list remove; do
  assert_contains "$HELP" "$cmd" "CLI exposes '$cmd' (skill quick-ref valid)"
done

# the full documented workflow, start to finish, for a fresh app:
# build → author (per instruction conventions) → register → verify
WALK="walkthrough"
$WREN genbi build "$WALK" --prompt "orders dashboard" -p "$PROJECT" > "$WORK/walk-build.out"
mkdir -p "$PROJECT/apps/$WALK/data"
echo "<html><body>walkthrough</body></html>" > "$PROJECT/apps/$WALK/index.html"
cp "$PROJECT/target/mdl.json" "$PROJECT/apps/$WALK/mdl.json"
printf 'PAR1fake' > "$PROJECT/apps/$WALK/data/orders.parquet"
$WREN genbi register "$WALK" --data-mode snapshot -p "$PROJECT" > /dev/null
$WREN genbi verify "$WALK" -p "$PROJECT" > "$WORK/walk-verify.out"
assert_contains "$WORK/walk-verify.out" "Verify passed" "full walkthrough reaches verified state"
$WREN genbi list -p "$PROJECT" > "$WORK/walk-list.out"
assert_contains "$WORK/walk-list.out" "$WALK" "walkthrough app visible in list"

# ── Summary ─────────────────────────────────────────────────────────────────
echo
echo "passed: $PASS, failed: $FAIL"
[ "$FAIL" -eq 0 ] || exit 1
