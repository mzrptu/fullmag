set shell := ["bash", "-euo", "pipefail", "-c"]

repo_root := justfile_directory()
local_bin := repo_root + "/.fullmag/local/bin"

default:
    @just --list

help:
    @just --list

build target="fullmag":
    if [ "{{target}}" = "fullmag" ]; then make install-cli; \
    elif [ "{{target}}" = "fullmag-host" ]; then make install-cli; \
    elif [ "{{target}}" = "dev-image" ]; then docker compose build dev; \
    elif [ "{{target}}" = "fem-gpu-runtime" ]; then docker compose --profile fem-gpu build fem-gpu; \
    elif [ "{{target}}" = "fem-gpu-runtime-host" ]; then ./scripts/export_fem_gpu_runtime.sh; \
    else echo "unknown build target: {{target}}" >&2; echo "supported targets: fullmag, fullmag-host, dev-image, fem-gpu-runtime, fem-gpu-runtime-host" >&2; exit 1; fi

package target="fullmag":
    if [ "{{target}}" = "fullmag" ] || [ "{{target}}" = "fullmag-host" ]; then ./scripts/package_fullmag_host.sh; \
    else echo "unknown package target: {{target}}" >&2; echo "supported targets: fullmag, fullmag-host" >&2; exit 1; fi

check:
    cargo +nightly check --workspace

test:
    cargo +nightly test --workspace

repo-check:
    python3 scripts/check_repo_consistency.py

control-room session="":
    if [ -n "{{session}}" ]; then ./scripts/dev-control-room.sh "{{session}}"; else ./scripts/dev-control-room.sh; fi

control-room-stop:
    ./scripts/stop-control-room.sh

run script:
    PATH="{{local_bin}}:$PATH" fullmag {{script}}

run-headless script:
    PATH="{{local_bin}}:$PATH" fullmag {{script}} --headless --json

run-py-layer-hole:
    PATH="{{local_bin}}:$PATH" fullmag examples/py_layer_hole_relax_150nm.py

run-py-layer-hole-headless:
    PATH="{{local_bin}}:$PATH" fullmag examples/py_layer_hole_relax_150nm.py --headless --json

fem-gpu-headless script:
    docker compose --profile fem-gpu run --rm fem-gpu bash -lc '\
      set -euo pipefail; \
      cargo +nightly clean -p fullmag-fdm-demag >/dev/null 2>&1 || true; \
      FULLMAG_USE_MFEM_STACK=ON cargo +nightly build -p fullmag-cli --features "cuda fem-gpu" >/tmp/fullmag-build.log; \
      FEM_LIB=$$(dirname "$$(find target/debug/build -path "*fullmag-fem-sys*/out/native-build/backends/fem/libfullmag_fem.so.0" | head -n1)"); \
      FDM_LIB=$$(dirname "$$(find target/debug/build -path "*fullmag-fdm-sys*/out/native-build/backends/fdm/libfullmag_fdm.so.0" | head -n1)"); \
      export LD_LIBRARY_PATH="$$FEM_LIB:$$FDM_LIB:/opt/fullmag-deps/lib:$${LD_LIBRARY_PATH:-}"; \
      FULLMAG_FEM_EXECUTION=gpu FULLMAG_FEM_GPU_INDEX=0 FULLMAG_FDM_GPU_INDEX=0 \
      ./target/debug/fullmag {{script}} --backend fem --headless --json \
    '

fem-gpu-py-layer-hole-headless:
    just fem-gpu-headless examples/py_layer_hole_relax_150nm.py
