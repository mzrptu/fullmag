/*
 * context.hpp — Internal FDM backend context.
 *
 * Wraps device state, material constants, and GPU resources.
 * NOT part of the public ABI.
 */

#ifndef FULLMAG_FDM_CONTEXT_HPP
#define FULLMAG_FDM_CONTEXT_HPP

#include "fullmag_fdm.h"

#include <cstdint>
#include <string>
#include <vector>

#ifdef FULLMAG_HAS_CUDA
#include <cuda_runtime.h>
#include <cufft.h>
#endif

namespace fullmag {
namespace fdm {

/// Per-component SoA device arrays for a 3D vector field.
struct DeviceVectorField {
    void *x = nullptr;
    void *y = nullptr;
    void *z = nullptr;
};

struct Context {
    // Grid
    uint32_t nx, ny, nz;
    uint64_t cell_count;
    double dx, dy, dz;

    // Material
    double Ms, A, alpha, gamma;
    bool enable_exchange = true;
    bool enable_demag = false;
    bool has_external_field = false;
    double external_field[3] = {0.0, 0.0, 0.0};

    // Execution
    fullmag_fdm_precision precision;
    fullmag_fdm_integrator integrator;

    // Step counter
    uint64_t step_count = 0;
    double current_time = 0.0;

    // Device state (SoA layout)
    DeviceVectorField m;      // magnetization
    DeviceVectorField h_ex;   // exchange field
    DeviceVectorField h_demag;// demag field
    DeviceVectorField k1;     // predictor RHS
    DeviceVectorField tmp;    // predictor state
    DeviceVectorField work;   // effective field / scratch

    // Demag FFT resources
    uint32_t fft_nx = 0;
    uint32_t fft_ny = 0;
    uint32_t fft_nz = 0;
    uint64_t fft_cell_count = 0;
    void *fft_x = nullptr;
    void *fft_y = nullptr;
    void *fft_z = nullptr;
    cufftHandle fft_plan = 0;
    bool fft_plan_valid = false;

    // Device info cache
    fullmag_fdm_device_info device_info_cache;
    bool device_info_valid = false;

    // Error state
    std::string last_error;
};

#ifdef FULLMAG_HAS_CUDA

/// Allocate all device buffers.
bool context_alloc_device(Context &ctx);

/// Free all device buffers.
void context_free_device(Context &ctx);

/// Upload initial magnetization (AoS f64 host → SoA device).
bool context_upload_magnetization(Context &ctx, const double *m_xyz, uint64_t len);

/// Download a field observable from device to host as f64 AoS.
bool context_download_field_f64(
    const Context &ctx,
    fullmag_fdm_observable observable,
    double *out_xyz,
    uint64_t out_len);

/// Populate device info cache.
bool context_query_device_info(Context &ctx);

/// Populate H_ex / H_demag / H_eff for the current state without advancing time.
bool context_refresh_observables(Context &ctx);

#endif // FULLMAG_HAS_CUDA

} // namespace fdm
} // namespace fullmag

#endif // FULLMAG_FDM_CONTEXT_HPP
