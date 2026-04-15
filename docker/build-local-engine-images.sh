#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

WREN_ENGINE_IMAGE="${WREN_ENGINE_IMAGE_REPO:-wren-engine}:${WREN_ENGINE_IMAGE_TAG:-local}"
IBIS_SERVER_IMAGE="${IBIS_SERVER_IMAGE_REPO:-wren-engine-ibis}:${IBIS_SERVER_IMAGE_TAG:-local}"
IBIS_SERVER_BUILD_ENV="${IBIS_SERVER_BUILD_ENV:-prod}"

platform_args=()
if [[ -n "${PLATFORM:-}" ]]; then
  platform_args+=(--platform "${PLATFORM}")
fi

docker build "${platform_args[@]}" \
  -t "${WREN_ENGINE_IMAGE}" \
  -f "${REPO_ROOT}/wren-engine/docker/wren-engine.Dockerfile" \
  "${REPO_ROOT}/wren-engine"

docker build "${platform_args[@]}" \
  --build-arg "ENV=${IBIS_SERVER_BUILD_ENV}" \
  -t "${IBIS_SERVER_IMAGE}" \
  -f "${REPO_ROOT}/wren-engine/docker/ibis-server.Dockerfile" \
  "${REPO_ROOT}/wren-engine"

echo "Built ${WREN_ENGINE_IMAGE}"
echo "Built ${IBIS_SERVER_IMAGE}"
