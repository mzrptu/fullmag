#!/usr/bin/env bash
# Benchmark: FEM CPU reference  vs  FEM GPU  vs  FDM CUDA
# Same physical problem (exchange + demag + Zeeman on Py box, 200 ps).
#
# Usage:
#   ./scripts/bench_fem_gpu.sh
#   SIM_SCRIPT=examples/fem_exchange_demag_zeeman.py ./scripts/bench_fem_gpu.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCAL_BIN="$REPO_ROOT/.fullmag/local/bin"
FULLMAG="$LOCAL_BIN/fullmag"
FULLMAG_GPU="$REPO_ROOT/.fullmag/runtimes/fem-gpu-host/bin/fullmag-fem-gpu"
FULLMAG_PYTHON="$REPO_ROOT/.fullmag/local/python/bin/python"

# Default to the dedicated GPU benchmark script; override via env
FEM_SCRIPT="${SIM_SCRIPT:-$REPO_ROOT/examples/bench_fem_gpu_long.py}"
FDM_SCRIPT="${FDM_SCRIPT:-$REPO_ROOT/examples/exchange_demag_zeeman.py}"

# Pick a rundir so both runs don't collide
RUNDIR_CPU="/tmp/fullmag_bench_fem_cpu"
RUNDIR_GPU="/tmp/fullmag_bench_fem_gpu"
RUNDIR_FDM="/tmp/fullmag_bench_fdm_cuda"

export FULLMAG_PYTHON

run_timed() {
    local label="$1"; shift
    local rundir="$1"; shift
    rm -rf "$rundir"
    mkdir -p "$rundir"

    echo "" >&2
    echo "──────────────────────────────────────────────────────────────" >&2
    echo "  $label" >&2
    echo "──────────────────────────────────────────────────────────────" >&2

    local start end elapsed
    start=$(date +%s%N)
    PATH="$LOCAL_BIN:$PATH" \
        FULLMAG_RUN_DIR="$rundir" \
        "$@" \
        --headless 2>&1 | grep -v "^\s*$" >&2 || true
    end=$(date +%s%N)

    elapsed=$(( (end - start) / 1000000 ))   # ms
    echo "  Wall time: ${elapsed} ms  ($(( elapsed / 1000 )).$(( (elapsed % 1000) / 100 )) s)" >&2
    # one number on stdout — captured by caller
    echo "$elapsed"
}

echo "================================================================"
echo "  fullmag FEM GPU benchmark"
echo "  FEM script : $FEM_SCRIPT"
echo "  GPU        : $(nvidia-smi -L 2>/dev/null | head -1 || echo 'unknown')"
echo "================================================================"

# ── 1. FEM CPU reference ───────────────────────────────────────────
T_CPU=$(run_timed "FEM  CPU  (MFEM serial reference)" "$RUNDIR_CPU" \
    env FULLMAG_FEM_EXECUTION=cpu \
    "$FULLMAG" "$FEM_SCRIPT")

# ── 2. FEM GPU (new MFEM/CUDA backend) ────────────────────────────
# Use the managed runtime binary directly — it sets LD_LIBRARY_PATH and
# FULLMAG_FEM_EXECUTION=gpu itself, bypassing the wrapper routing logic.
if [[ -x "$FULLMAG_GPU" ]]; then
    T_GPU=$(run_timed "FEM  GPU  (MFEM + CUDA, RTX 4080 SUPER)" "$RUNDIR_GPU" \
        env FULLMAG_FEM_GPU_INDEX=0 \
        "$FULLMAG_GPU" "$FEM_SCRIPT")
else
    echo ""
    echo "  (FEM GPU managed runtime not found at $FULLMAG_GPU)"
    echo "  Run './scripts/export_fem_gpu_runtime.sh' first."
    T_GPU="NOT_FOUND"
fi

# ── 3. FDM CUDA (FDM native CUDA, for reference) ──────────────────
# Only run if the FDM equivalent script exists
T_FDM="N/A"
if [[ -f "$FDM_SCRIPT" ]]; then
    T_FDM=$(run_timed "FDM  CUDA (FDM native CUDA, same physics)" "$RUNDIR_FDM" \
        env FULLMAG_FDM_EXECUTION=cuda FULLMAG_FDM_GPU_INDEX=0 \
        "$FULLMAG" "$FDM_SCRIPT") || T_FDM="FAILED"
else
    echo ""
    echo "  (FDM equivalent script not found at $FDM_SCRIPT — skipping FDM run)"
fi

# ── Summary ───────────────────────────────────────────────────────
echo ""
echo "================================================================"
echo "  RESULTS SUMMARY"
echo "================================================================"
printf "  %-30s  %10s  %10s\n" "Backend" "Time (ms)" "Speedup vs CPU"
printf "  %-30s  %10s  %10s\n" "------------------------------" "----------" "--------------"

printf "  %-30s  %10s  %10s\n" "FEM CPU reference" "${T_CPU} ms" "1.00×  (baseline)"

if [[ "$T_GPU" =~ ^[0-9]+$ ]] && [[ "$T_CPU" =~ ^[0-9]+$ ]]; then
    # bash integer arithmetic — use awk for float division
    speedup_gpu=$(awk "BEGIN { printf \"%.2f\", $T_CPU / $T_GPU }")
    printf "  %-30s  %10s  %10s\n" "FEM GPU (MFEM+CUDA)" "${T_GPU} ms" "${speedup_gpu}×"
else
    printf "  %-30s  %10s  %10s\n" "FEM GPU (MFEM+CUDA)" "${T_GPU}" "N/A"
fi

if [[ "$T_FDM" =~ ^[0-9]+$ ]] && [[ "$T_CPU" =~ ^[0-9]+$ ]]; then
    speedup_fdm=$(awk "BEGIN { printf \"%.2f\", $T_CPU / $T_FDM }")
    printf "  %-30s  %10s  %10s\n" "FDM CUDA (reference)" "${T_FDM} ms" "${speedup_fdm}×  (different method)"
else
    printf "  %-30s  %10s  %10s\n" "FDM CUDA" "${T_FDM}" "N/A"
fi

echo "================================================================"
