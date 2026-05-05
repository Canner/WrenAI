#!/usr/bin/env bash
#
# Local doc sync: WrenAI/docs/core → doc website via PR
# Mirrors .github/workflows/sync-docs.yml but runs from your machine
# using the `gh` CLI.
#
# Requires DOCS_REPO to be set as a GitHub repository variable, or
# passed via environment: DOCS_REPO=owner/repo DOCS_REPO_BRANCH=master
#
# Usage:
#   ./scripts/sync-docs.sh            # dry-run (show diff, no PR)
#   ./scripts/sync-docs.sh --apply    # create branch + PR
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE_REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || echo "Canner/WrenAI")"

# Read from GitHub repo variables, allow env override
TARGET_REPO="${DOCS_REPO:-$(gh variable get DOCS_REPO -R "$SOURCE_REPO" 2>/dev/null || true)}"
TARGET_BRANCH="${DOCS_REPO_BRANCH:-$(gh variable get DOCS_REPO_BRANCH -R "$SOURCE_REPO" 2>/dev/null || echo "master")}"

if [[ -z "$TARGET_REPO" ]]; then
  echo "error: DOCS_REPO not set. Either:" >&2
  echo "  1. Set GitHub repo variable: gh variable set DOCS_REPO -R $SOURCE_REPO --body 'owner/repo'" >&2
  echo "  2. Pass via env: DOCS_REPO=owner/repo $0" >&2
  exit 1
fi

TARGET_DIR="docs/oss"
SYNC_FILES=(introduction.mdx)
SYNC_DIRS=(get_started concepts guides reference)
SHORT_SHA="$(git -C "$REPO_ROOT" rev-parse --short=8 HEAD)"

# --- preflight ---
if ! command -v gh &>/dev/null; then
  echo "error: gh CLI not found — install from https://cli.github.com" >&2
  exit 1
fi
if ! gh auth status &>/dev/null 2>&1; then
  echo "error: not authenticated — run 'gh auth login' first" >&2
  exit 1
fi

# --- clone target into a temp dir ---
TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

echo "Syncing docs → ${TARGET_REPO} (${TARGET_BRANCH})..."
gh repo clone "$TARGET_REPO" "$TMPDIR/docs-site" -- --branch "$TARGET_BRANCH" --single-branch --depth 1 -q

TARGET="$TMPDIR/docs-site/${TARGET_DIR}"
mkdir -p "${TARGET}"

# --- sync (additive overlay — no rm -rf; matches the GitHub Action) ---
# Stale files left behind by source-side renames or deletions must be
# cleaned up manually by a maintainer in the docs site repo. The plural
# folder names (concepts, guides) are deliberately different from the
# GenBI legacy folders that use singular names (concept, guide) under
# docs/oss/genbi/ on the docs site.
for file in "${SYNC_FILES[@]}"; do
  cp "${REPO_ROOT}/docs/core/${file}" "${TARGET}/${file}"
done
for dir in "${SYNC_DIRS[@]}"; do
  mkdir -p "${TARGET}/${dir}"
  cp -r "${REPO_ROOT}/docs/core/${dir}/." "${TARGET}/${dir}/"
done

# --- diff ---
cd "$TMPDIR/docs-site"
if git diff --quiet; then
  echo "No changes — docs are already in sync."
  exit 0
fi

echo ""
echo "=== Changes ==="
git diff --stat
echo ""

if [[ "${1:-}" != "--apply" ]]; then
  echo "(dry-run) Re-run with --apply to create a PR."
  exit 0
fi

# --- create PR ---
BRANCH="sync/core-docs-${SHORT_SHA}"
git checkout -b "$BRANCH"
git add -A
git commit -m "docs: sync from WrenAI@${SHORT_SHA}"
git push origin "$BRANCH"

PR_URL=$(gh pr create \
  --title "docs: sync Wren AI Core docs from ${SOURCE_REPO}" \
  --body "Manual sync from [\`${SOURCE_REPO}@${SHORT_SHA}\`](https://github.com/${SOURCE_REPO}/commit/${SHORT_SHA})." \
  --base "$TARGET_BRANCH")

echo ""
echo "PR created: ${PR_URL}"
