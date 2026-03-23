#!/bin/bash
# Build and test the native CUDA FDM backend in a container.
#
# Supports both Podman and Docker. Podman is preferred.
#
# Usage:
#   ./scripts/test-cuda-native.sh          # build + test
#   ./scripts/test-cuda-native.sh build    # build only
#   ./scripts/test-cuda-native.sh test     # test only (assumes image exists)

set -euo pipefail

IMAGE="fullmag-cuda-test"
CONTAINERFILE="native/Containerfile"
CONTEXT="native/"

# Detect container runtime
if command -v podman &>/dev/null; then
    RUNTIME=podman
    GPU_FLAG="--device nvidia.com/gpu=all"
    # Rootless podman without systemd user session needs explicit cgroup manager
    export CGROUP_MANAGER="${CGROUP_MANAGER:-cgroupfs}"
    PODMAN_EXTRA="--cgroup-manager=$CGROUP_MANAGER --events-backend=file"
elif command -v docker &>/dev/null; then
    RUNTIME=docker
    GPU_FLAG="--gpus all"
    PODMAN_EXTRA=""
else
    echo "ERROR: neither podman nor docker found" >&2
    exit 1
fi

echo "Using runtime: $RUNTIME"

case "${1:-all}" in
    build)
        echo "Building CUDA test container..."
        $RUNTIME $PODMAN_EXTRA build -f "$CONTAINERFILE" -t "$IMAGE" "$CONTEXT"
        echo "Build complete."
        ;;
    test)
        echo "Running CUDA tests..."
        $RUNTIME $PODMAN_EXTRA run --rm $GPU_FLAG "$IMAGE"
        ;;
    all|*)
        echo "Building CUDA test container..."
        $RUNTIME $PODMAN_EXTRA build -f "$CONTAINERFILE" -t "$IMAGE" "$CONTEXT"
        echo ""
        echo "Running CUDA tests..."
        $RUNTIME $PODMAN_EXTRA run --rm $GPU_FLAG "$IMAGE"
        ;;
esac
