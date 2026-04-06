#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE_NAME="${FULLMAG_LINUX_DESKTOP_IMAGE:-fullmag/linux-desktop-build:ubuntu24.04}"

command -v docker >/dev/null 2>&1 || {
  echo "Missing required command: docker" >&2
  exit 1
}

echo "Building Linux desktop container image: ${IMAGE_NAME}"
docker build -t "${IMAGE_NAME}" -f "${REPO_ROOT}/docker/linux-desktop/Dockerfile" "${REPO_ROOT}"

echo "Building Linux desktop artifacts and installer inside container"
docker run --rm \
  -v "${REPO_ROOT}:/workspace/fullmag" \
  -w /workspace/fullmag \
  "${IMAGE_NAME}" \
  bash -lc '
    set -euo pipefail
    pnpm install --frozen-lockfile
    cargo build --release -p fullmag-desktop
    just package-installer-linux
  '

echo "Linux installer build finished."
echo "Expected artifacts:"
echo "  ${REPO_ROOT}/target/release/fullmag-ui"
echo "  ${REPO_ROOT}/.fullmag/dist/fullmag-linux-x86_64-portable.tar.zst"
echo "  ${REPO_ROOT}/.fullmag/dist/"'fullmag-<version>-linux-x86_64.run'
