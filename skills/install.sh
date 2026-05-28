#!/usr/bin/env bash
# Install the Wren AI agent skill discovery stub into your local AI client.
#
# The actual skill content lives inside the `wren` CLI itself
# (`pip install wrenai`). This script installs the discovery stub (`wren`)
# that points an AI client at the CLI; from then on the agent fetches
# everything else via `wren skills get` / `wren docs get` / `wren ask`.
#
# Usage:
#   ./install.sh                # install the discovery stub
#   ./install.sh --force        # overwrite an existing install
#   curl -fsSL https://raw.githubusercontent.com/Canner/WrenAI/main/skills/install.sh | bash

set -euo pipefail

REPO="Canner/WrenAI"
BRANCH="${WREN_SKILLS_BRANCH:-main}"
DEST="${CLAUDE_SKILLS_DIR:-$HOME/.claude/skills}"
SKILL="wren"

FORCE=false
for arg in "$@"; do
  case "$arg" in
    --force) FORCE=true ;;
    *) echo "Unknown argument: $arg" >&2; exit 1 ;;
  esac
done

# Detect whether we are running from a local clone or piped via curl.
SCRIPT_DIR=""
if [ -n "${BASH_SOURCE[0]:-}" ] && [ "${BASH_SOURCE[0]}" != "/dev/stdin" ]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi

install_skill() {
  local src="$1" dest_dir="$2"
  if [ "$FORCE" = false ] && [ -d "$dest_dir" ]; then
    echo "  Skipping $SKILL (already exists). Use --force to overwrite."
    return
  fi
  rm -rf "$dest_dir"
  cp -r "$src" "$dest_dir"
  echo "  Installed $SKILL"
}

mkdir -p "$DEST"

if [ -n "$SCRIPT_DIR" ] && [ -d "$SCRIPT_DIR/$SKILL" ]; then
  echo "Installing from local repo: $SCRIPT_DIR"
  echo "Destination: $DEST"
  echo ""
  install_skill "$SCRIPT_DIR/$SKILL" "$DEST/$SKILL"
else
  echo "Downloading skill from GitHub ($REPO @ $BRANCH)..."
  echo "Destination: $DEST"
  echo ""
  tmpdir=$(mktemp -d)
  trap 'rm -rf "$tmpdir"' EXIT
  curl -fsSL "https://github.com/$REPO/archive/refs/heads/$BRANCH.tar.gz" \
    | tar -xz -C "$tmpdir" --strip-components=2 "WrenAI-${BRANCH}/skills/${SKILL}"
  install_skill "$tmpdir/$SKILL" "$DEST/$SKILL"
fi

echo ""
echo "Done. Invoke the skill in your AI client:"
echo "  /$SKILL"
echo ""
echo "To update later, re-run with --force:"
echo "  curl -fsSL https://raw.githubusercontent.com/Canner/WrenAI/main/skills/install.sh | bash -s -- --force"
