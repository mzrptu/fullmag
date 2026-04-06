// ── S11: CUDA kernel declarations for fused LLG + field ops ───────────
// All kernels use double precision (fp64) SoA layout.
// Single precision (fp32) is NOT supported — attempting to instantiate
// float variants will fail at compile time.
#pragma once

#if FULLMAG_HAS_CUDA_RUNTIME
#include <cuda_runtime.h>
#include <cstddef>
#include <type_traits>

namespace fullmag::fem {

/// Precision type used by all FEM CUDA kernels.
using fem_real_t = double;

// Compile-time guard: block single-precision (FEM-012).
static_assert(std::is_same_v<fem_real_t, double>,
    "fullmag FEM native kernels require double precision; "
    "single precision (float) is not implemented — set fem_real_t = double");

/// Fused LLG RHS: dm/dt = -γ̄ (m×H + α m×(m×H)), per-block max reduction.
/// Input/output: SoA layout (separate mx, my, mz arrays).
void fullmag_cuda_llg_rhs_fused(
    const fem_real_t *mx, const fem_real_t *my, const fem_real_t *mz,
    const fem_real_t *hx, const fem_real_t *hy, const fem_real_t *hz,
    fem_real_t *dmx, fem_real_t *dmy, fem_real_t *dmz,
    fem_real_t *block_max_rhs,
    fem_real_t gamma, fem_real_t alpha,
    int N, cudaStream_t stream = nullptr);

/// Normalize each (mx,my,mz) to unit length (SoA layout).
void fullmag_cuda_normalize_vectors(
    fem_real_t *mx, fem_real_t *my, fem_real_t *mz,
    int N, cudaStream_t stream = nullptr);

/// h_eff = h_ex + h_demag [+ h_ext] (element-wise, SoA component).
void fullmag_cuda_accumulate_heff(
    const fem_real_t *h_ex, const fem_real_t *h_demag, const fem_real_t *h_ext,
    fem_real_t *h_eff,
    int N, bool has_ext, cudaStream_t stream = nullptr);

/// Query/execute CUB device-wide max reduction.
/// Call once with temp_storage=nullptr to get temp_storage_bytes,
/// then again with allocated buffer.
void fullmag_cuda_device_max(
    const fem_real_t *data, int N, fem_real_t *result,
    void *temp_storage, size_t &temp_storage_bytes,
    cudaStream_t stream = nullptr);

} // namespace fullmag::fem

#endif // FULLMAG_HAS_CUDA_RUNTIME
