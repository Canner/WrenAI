#!/usr/bin/env bash
#
# Build and publish wrenai to PyPI or TestPyPI.
#
# Usage:
#   ./scripts/publish.sh            # build + publish to PyPI
#   ./scripts/publish.sh --test     # build + publish to TestPyPI
#   ./scripts/publish.sh --build    # build only (no publish)
#
# Prerequisites:
#   - uv    (https://docs.astral.sh/uv/)
#   - twine (pip install twine)  — only needed for publish
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DIST_DIR="$PROJECT_DIR/dist"

MODE="publish"       # publish | test | build
REPOSITORY="pypi"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --test)
            MODE="test"
            REPOSITORY="testpypi"
            shift
            ;;
        --build)
            MODE="build"
            shift
            ;;
        -h|--help)
            echo "Usage: $0 [--test | --build | -h]"
            echo ""
            echo "  (no flag)   Build and publish to PyPI"
            echo "  --test      Build and publish to TestPyPI"
            echo "  --build     Build only, no publish"
            echo "  -h, --help  Show this help"
            exit 0
            ;;
        *)
            echo "Unknown option: $1" >&2
            exit 1
            ;;
    esac
done

cd "$PROJECT_DIR"

# --- Check prerequisites ---
if ! command -v uv &>/dev/null; then
    echo "Error: 'uv' is not installed. See https://docs.astral.sh/uv/" >&2
    exit 1
fi

if [[ "$MODE" != "build" ]]; then
    if ! command -v twine &>/dev/null; then
        echo "Error: 'twine' is not installed. Run: pip install twine" >&2
        exit 1
    fi
fi

# --- Read version from __init__.py ---
VERSION=$(sed -nE 's/^__version__\s*=\s*"([^"]+)".*/\1/p' src/wren/__init__.py | head -n1)
if [[ -z "$VERSION" ]]; then
    echo "Error: failed to parse __version__ from src/wren/__init__.py" >&2
    exit 1
fi
echo "==> Building wrenai v${VERSION}"

# --- Clean previous dist ---
rm -rf "$DIST_DIR"

# --- Build sdist + wheel ---
echo "==> Running uv build"
uv build

# --- List artifacts ---
echo ""
echo "==> Built artifacts:"
ls -lh "$DIST_DIR"

# --- Validate ---
echo ""
echo "==> Validating with twine check"
if command -v twine &>/dev/null; then
    twine check "$DIST_DIR"/*
elif [[ "$MODE" == "build" ]]; then
    echo "Warning: twine not installed; skipping validation in build-only mode"
else
    echo "Error: 'twine' is not installed. Run: pip install twine" >&2
    exit 1
fi

if [[ "$MODE" == "build" ]]; then
    echo ""
    echo "==> Build complete. Artifacts in: $DIST_DIR"
    exit 0
fi

# --- Publish ---
echo ""
if [[ "$REPOSITORY" == "testpypi" ]]; then
    echo "==> Publishing to TestPyPI"
    echo "    After upload, install with:"
    echo "    pip install --index-url https://test.pypi.org/simple/ wrenai"
else
    echo "==> Publishing to PyPI"
fi
echo ""

twine upload --repository "$REPOSITORY" "$DIST_DIR"/*

echo ""
echo "==> Done! Published wrenai v${VERSION} to ${REPOSITORY}"
