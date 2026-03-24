/*
 * demag_fp32.cu — GPU single-precision demag field, effective field, and
 * energy helpers.
 *
 * State/FFT are fp32; host-side reductions are accumulated in fp64.
 */

#include "context.hpp"

#include <cuda_runtime.h>
#include <cufft.h>
#include <cmath>
#include <vector>

namespace fullmag {
namespace fdm {

extern void set_cuda_error(Context &ctx, const char *operation, cudaError_t err);
extern void set_cufft_error(Context &ctx, const char *operation, cufftResult err);

namespace {

constexpr double MU0 = 4.0 * M_PI * 1e-7;
constexpr int BLOCK_SIZE = 256;

__device__ inline int frequency_index(int i, int n) {
    return (i <= n / 2) ? i : (i - n);
}

__global__ void pack_magnetization_fft_fp32_kernel(
    const float * __restrict__ mx,
    const float * __restrict__ my,
    const float * __restrict__ mz,
    cufftComplex * __restrict__ fx,
    cufftComplex * __restrict__ fy,
    cufftComplex * __restrict__ fz,
    int nx, int ny, int nz,
    int px, int py, int pz,
    float ms)
{
    int idx = blockIdx.x * blockDim.x + threadIdx.x;
    int total = px * py * pz;
    if (idx >= total) return;

    int z = idx / (py * px);
    int rem = idx - z * py * px;
    int y = rem / px;
    int x = rem - y * px;

    if (x < nx && y < ny && z < nz) {
        int src = z * ny * nx + y * nx + x;
        fx[idx] = make_cuFloatComplex(ms * mx[src], 0.0f);
        fy[idx] = make_cuFloatComplex(ms * my[src], 0.0f);
        fz[idx] = make_cuFloatComplex(ms * mz[src], 0.0f);
    } else {
        fx[idx] = make_cuFloatComplex(0.0f, 0.0f);
        fy[idx] = make_cuFloatComplex(0.0f, 0.0f);
        fz[idx] = make_cuFloatComplex(0.0f, 0.0f);
    }
}

__global__ void spectral_projection_fp32_kernel(
    cufftComplex * __restrict__ fx,
    cufftComplex * __restrict__ fy,
    cufftComplex * __restrict__ fz,
    int px, int py, int pz,
    float dx, float dy, float dz)
{
    int idx = blockIdx.x * blockDim.x + threadIdx.x;
    int total = px * py * pz;
    if (idx >= total) return;

    int z = idx / (py * px);
    int rem = idx - z * py * px;
    int y = rem / px;
    int x = rem - y * px;

    float lx = px * dx;
    float ly = py * dy;
    float lz = pz * dz;
    float kx = 2.0f * static_cast<float>(M_PI) * static_cast<float>(frequency_index(x, px)) / lx;
    float ky = 2.0f * static_cast<float>(M_PI) * static_cast<float>(frequency_index(y, py)) / ly;
    float kz = 2.0f * static_cast<float>(M_PI) * static_cast<float>(frequency_index(z, pz)) / lz;
    float k2 = kx * kx + ky * ky + kz * kz;

    if (k2 == 0.0f) {
        fx[idx] = make_cuFloatComplex(0.0f, 0.0f);
        fy[idx] = make_cuFloatComplex(0.0f, 0.0f);
        fz[idx] = make_cuFloatComplex(0.0f, 0.0f);
        return;
    }

    cufftComplex mx = fx[idx];
    cufftComplex my = fy[idx];
    cufftComplex mz = fz[idx];

    cufftComplex kdotm = make_cuFloatComplex(
        kx * mx.x + ky * my.x + kz * mz.x,
        kx * mx.y + ky * my.y + kz * mz.y);

    float sx = -kx / k2;
    float sy = -ky / k2;
    float sz = -kz / k2;

    fx[idx] = make_cuFloatComplex(kdotm.x * sx, kdotm.y * sx);
    fy[idx] = make_cuFloatComplex(kdotm.x * sy, kdotm.y * sy);
    fz[idx] = make_cuFloatComplex(kdotm.x * sz, kdotm.y * sz);
}

__global__ void unpack_demag_fft_fp32_kernel(
    const cufftComplex * __restrict__ fx,
    const cufftComplex * __restrict__ fy,
    const cufftComplex * __restrict__ fz,
    float * __restrict__ hx,
    float * __restrict__ hy,
    float * __restrict__ hz,
    int nx, int ny, int nz,
    int px, int py,
    float normalisation)
{
    int idx = blockIdx.x * blockDim.x + threadIdx.x;
    int total = nx * ny * nz;
    if (idx >= total) return;

    int z = idx / (ny * nx);
    int rem = idx - z * ny * nx;
    int y = rem / nx;
    int x = rem - y * nx;
    int src = z * py * px + y * px + x;

    hx[idx] = fx[src].x * normalisation;
    hy[idx] = fy[src].x * normalisation;
    hz[idx] = fz[src].x * normalisation;
}

__global__ void combine_effective_field_fp32_kernel(
    const float * __restrict__ h_ex_x,
    const float * __restrict__ h_ex_y,
    const float * __restrict__ h_ex_z,
    const float * __restrict__ h_demag_x,
    const float * __restrict__ h_demag_y,
    const float * __restrict__ h_demag_z,
    float * __restrict__ h_eff_x,
    float * __restrict__ h_eff_y,
    float * __restrict__ h_eff_z,
    int n,
    int enable_exchange,
    int enable_demag,
    float hx_ext,
    float hy_ext,
    float hz_ext)
{
    int idx = blockIdx.x * blockDim.x + threadIdx.x;
    if (idx >= n) return;

    float hx = hx_ext;
    float hy = hy_ext;
    float hz = hz_ext;

    if (enable_exchange) {
        hx += h_ex_x[idx];
        hy += h_ex_y[idx];
        hz += h_ex_z[idx];
    }
    if (enable_demag) {
        hx += h_demag_x[idx];
        hy += h_demag_y[idx];
        hz += h_demag_z[idx];
    }

    h_eff_x[idx] = hx;
    h_eff_y[idx] = hy;
    h_eff_z[idx] = hz;
}

} // namespace

void launch_demag_field_fp32(Context &ctx) {
    if (!ctx.enable_demag) {
        return;
    }

    int total_padded = static_cast<int>(ctx.fft_cell_count);
    int grid_padded = (total_padded + BLOCK_SIZE - 1) / BLOCK_SIZE;
    int total_physical = static_cast<int>(ctx.cell_count);
    int grid_physical = (total_physical + BLOCK_SIZE - 1) / BLOCK_SIZE;

    pack_magnetization_fft_fp32_kernel<<<grid_padded, BLOCK_SIZE>>>(
        static_cast<const float*>(ctx.m.x),
        static_cast<const float*>(ctx.m.y),
        static_cast<const float*>(ctx.m.z),
        static_cast<cufftComplex*>(ctx.fft_x),
        static_cast<cufftComplex*>(ctx.fft_y),
        static_cast<cufftComplex*>(ctx.fft_z),
        static_cast<int>(ctx.nx),
        static_cast<int>(ctx.ny),
        static_cast<int>(ctx.nz),
        static_cast<int>(ctx.fft_nx),
        static_cast<int>(ctx.fft_ny),
        static_cast<int>(ctx.fft_nz),
        static_cast<float>(ctx.Ms));

    cufftResult err = cufftExecC2C(ctx.fft_plan, static_cast<cufftComplex*>(ctx.fft_x),
                                   static_cast<cufftComplex*>(ctx.fft_x), CUFFT_FORWARD);
    if (err != CUFFT_SUCCESS) { set_cufft_error(ctx, "cufftExecC2C(x, forward)", err); return; }
    err = cufftExecC2C(ctx.fft_plan, static_cast<cufftComplex*>(ctx.fft_y),
                       static_cast<cufftComplex*>(ctx.fft_y), CUFFT_FORWARD);
    if (err != CUFFT_SUCCESS) { set_cufft_error(ctx, "cufftExecC2C(y, forward)", err); return; }
    err = cufftExecC2C(ctx.fft_plan, static_cast<cufftComplex*>(ctx.fft_z),
                       static_cast<cufftComplex*>(ctx.fft_z), CUFFT_FORWARD);
    if (err != CUFFT_SUCCESS) { set_cufft_error(ctx, "cufftExecC2C(z, forward)", err); return; }

    spectral_projection_fp32_kernel<<<grid_padded, BLOCK_SIZE>>>(
        static_cast<cufftComplex*>(ctx.fft_x),
        static_cast<cufftComplex*>(ctx.fft_y),
        static_cast<cufftComplex*>(ctx.fft_z),
        static_cast<int>(ctx.fft_nx),
        static_cast<int>(ctx.fft_ny),
        static_cast<int>(ctx.fft_nz),
        static_cast<float>(ctx.dx),
        static_cast<float>(ctx.dy),
        static_cast<float>(ctx.dz));

    err = cufftExecC2C(ctx.fft_plan, static_cast<cufftComplex*>(ctx.fft_x),
                       static_cast<cufftComplex*>(ctx.fft_x), CUFFT_INVERSE);
    if (err != CUFFT_SUCCESS) { set_cufft_error(ctx, "cufftExecC2C(x, inverse)", err); return; }
    err = cufftExecC2C(ctx.fft_plan, static_cast<cufftComplex*>(ctx.fft_y),
                       static_cast<cufftComplex*>(ctx.fft_y), CUFFT_INVERSE);
    if (err != CUFFT_SUCCESS) { set_cufft_error(ctx, "cufftExecC2C(y, inverse)", err); return; }
    err = cufftExecC2C(ctx.fft_plan, static_cast<cufftComplex*>(ctx.fft_z),
                       static_cast<cufftComplex*>(ctx.fft_z), CUFFT_INVERSE);
    if (err != CUFFT_SUCCESS) { set_cufft_error(ctx, "cufftExecC2C(z, inverse)", err); return; }

    unpack_demag_fft_fp32_kernel<<<grid_physical, BLOCK_SIZE>>>(
        static_cast<const cufftComplex*>(ctx.fft_x),
        static_cast<const cufftComplex*>(ctx.fft_y),
        static_cast<const cufftComplex*>(ctx.fft_z),
        static_cast<float*>(ctx.h_demag.x),
        static_cast<float*>(ctx.h_demag.y),
        static_cast<float*>(ctx.h_demag.z),
        static_cast<int>(ctx.nx),
        static_cast<int>(ctx.ny),
        static_cast<int>(ctx.nz),
        static_cast<int>(ctx.fft_nx),
        static_cast<int>(ctx.fft_ny),
        1.0f / static_cast<float>(ctx.fft_cell_count));
}

void launch_effective_field_fp32(Context &ctx) {
    int n = static_cast<int>(ctx.cell_count);
    int grid = (n + BLOCK_SIZE - 1) / BLOCK_SIZE;
    combine_effective_field_fp32_kernel<<<grid, BLOCK_SIZE>>>(
        static_cast<const float*>(ctx.h_ex.x),
        static_cast<const float*>(ctx.h_ex.y),
        static_cast<const float*>(ctx.h_ex.z),
        static_cast<const float*>(ctx.h_demag.x),
        static_cast<const float*>(ctx.h_demag.y),
        static_cast<const float*>(ctx.h_demag.z),
        static_cast<float*>(ctx.work.x),
        static_cast<float*>(ctx.work.y),
        static_cast<float*>(ctx.work.z),
        n,
        ctx.enable_exchange ? 1 : 0,
        ctx.enable_demag ? 1 : 0,
        ctx.has_external_field ? static_cast<float>(ctx.external_field[0]) : 0.0f,
        ctx.has_external_field ? static_cast<float>(ctx.external_field[1]) : 0.0f,
        ctx.has_external_field ? static_cast<float>(ctx.external_field[2]) : 0.0f);
}

double launch_demag_energy_fp32(Context &ctx) {
    if (!ctx.enable_demag) {
        return 0.0;
    }

    std::vector<float> mx(ctx.cell_count), my(ctx.cell_count), mz(ctx.cell_count);
    std::vector<float> hx(ctx.cell_count), hy(ctx.cell_count), hz(ctx.cell_count);
    cudaMemcpy(mx.data(), ctx.m.x, ctx.cell_count * sizeof(float), cudaMemcpyDeviceToHost);
    cudaMemcpy(my.data(), ctx.m.y, ctx.cell_count * sizeof(float), cudaMemcpyDeviceToHost);
    cudaMemcpy(mz.data(), ctx.m.z, ctx.cell_count * sizeof(float), cudaMemcpyDeviceToHost);
    cudaMemcpy(hx.data(), ctx.h_demag.x, ctx.cell_count * sizeof(float), cudaMemcpyDeviceToHost);
    cudaMemcpy(hy.data(), ctx.h_demag.y, ctx.cell_count * sizeof(float), cudaMemcpyDeviceToHost);
    cudaMemcpy(hz.data(), ctx.h_demag.z, ctx.cell_count * sizeof(float), cudaMemcpyDeviceToHost);

    double cell_volume = ctx.dx * ctx.dy * ctx.dz;
    double total = 0.0;
    for (uint64_t i = 0; i < ctx.cell_count; i++) {
        double mdoth = ctx.Ms * ((double)mx[i] * hx[i] + (double)my[i] * hy[i] + (double)mz[i] * hz[i]);
        total += -0.5 * MU0 * mdoth * cell_volume;
    }
    return total;
}

double launch_external_energy_fp32(Context &ctx) {
    if (!ctx.has_external_field) {
        return 0.0;
    }

    std::vector<float> mx(ctx.cell_count), my(ctx.cell_count), mz(ctx.cell_count);
    cudaMemcpy(mx.data(), ctx.m.x, ctx.cell_count * sizeof(float), cudaMemcpyDeviceToHost);
    cudaMemcpy(my.data(), ctx.m.y, ctx.cell_count * sizeof(float), cudaMemcpyDeviceToHost);
    cudaMemcpy(mz.data(), ctx.m.z, ctx.cell_count * sizeof(float), cudaMemcpyDeviceToHost);

    double cell_volume = ctx.dx * ctx.dy * ctx.dz;
    double total = 0.0;
    for (uint64_t i = 0; i < ctx.cell_count; i++) {
        double mdoth = ctx.Ms * ((double)mx[i] * ctx.external_field[0]
            + (double)my[i] * ctx.external_field[1]
            + (double)mz[i] * ctx.external_field[2]);
        total += -MU0 * mdoth * cell_volume;
    }
    return total;
}

} // namespace fdm
} // namespace fullmag
