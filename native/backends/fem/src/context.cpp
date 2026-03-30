#include "context.hpp"

#include <algorithm>
#include <cmath>
#include <cstring>
#include <random>

#if FULLMAG_HAS_CUDA_RUNTIME
#include <cuda_runtime.h>
#endif

namespace fullmag::fem {

namespace {

constexpr double kPi = 3.14159265358979323846;
constexpr double kB  = 1.380649e-23;   // Boltzmann constant [J/K]
constexpr double kMU0 = 4.0 * kPi * 1e-7;  // vacuum permeability [T·m/A]

template <typename T>
void copy_optional_span(
    const T *source,
    size_t count,
    std::vector<T> &destination,
    T fill_value = T{})
{
    destination.assign(count, fill_value);
    if (source != nullptr && count > 0) {
        std::copy(source, source + count, destination.begin());
    }
}

void fill_repeated_vector_field(
    std::vector<double> &buffer,
    uint32_t n_nodes,
    const std::array<double, 3> &value)
{
    buffer.resize(static_cast<size_t>(n_nodes) * 3u);
    for (uint32_t i = 0; i < n_nodes; ++i) {
        const size_t base = static_cast<size_t>(i) * 3u;
        buffer[base + 0] = value[0];
        buffer[base + 1] = value[1];
        buffer[base + 2] = value[2];
    }
}

void fill_zero_vector_field(std::vector<double> &buffer, uint32_t n_nodes) {
    buffer.assign(static_cast<size_t>(n_nodes) * 3u, 0.0);
}

} // namespace

bool context_from_plan(Context &ctx, const fullmag_fem_plan_desc &plan, std::string &error) {
    if (plan.mesh.n_nodes == 0) {
        error = "FEM mesh must contain at least one node";
        return false;
    }
    if (plan.mesh.n_elements == 0) {
        error = "FEM mesh must contain at least one tetrahedral element";
        return false;
    }
    if (plan.mesh.nodes_xyz == nullptr) {
        error = "FEM mesh nodes pointer is null";
        return false;
    }
    if (plan.mesh.elements == nullptr) {
        error = "FEM mesh elements pointer is null";
        return false;
    }
    if (plan.initial_magnetization_xyz == nullptr) {
        error = "initial magnetization pointer is null";
        return false;
    }

    const uint64_t expected_m_len = static_cast<uint64_t>(plan.mesh.n_nodes) * 3ull;
    if (plan.initial_magnetization_len != expected_m_len) {
        error = "initial magnetization length mismatch";
        return false;
    }
    if (plan.dt_seconds <= 0.0) {
        error = "FEM time step must be positive";
        return false;
    }

    ctx.n_nodes = plan.mesh.n_nodes;
    ctx.n_elements = plan.mesh.n_elements;
    ctx.n_boundary_faces = plan.mesh.n_boundary_faces;
    ctx.fe_order = plan.fe_order;
    ctx.hmax = plan.hmax;
    ctx.dt_seconds = plan.dt_seconds;
    ctx.air_box_factor = plan.air_box_factor;
    ctx.precision = plan.precision;
    ctx.integrator = plan.integrator;
    ctx.enable_exchange = plan.enable_exchange != 0;
    ctx.enable_demag = plan.enable_demag != 0;
    ctx.has_external_field = plan.has_external_field != 0;
    ctx.external_field_am = {
        plan.external_field_am[0],
        plan.external_field_am[1],
        plan.external_field_am[2],
    };
    ctx.enable_anisotropy = plan.has_uniaxial_anisotropy != 0;
    ctx.anisotropy_Ku = plan.uniaxial_anisotropy_constant;
    ctx.anisotropy_Ku2 = plan.uniaxial_anisotropy_k2;
    ctx.anisotropy_axis = {
        plan.anisotropy_axis[0],
        plan.anisotropy_axis[1],
        plan.anisotropy_axis[2],
    };
    ctx.enable_dmi = plan.has_interfacial_dmi != 0;
    ctx.dmi_D = plan.dmi_constant;
    ctx.enable_bulk_dmi = plan.has_bulk_dmi != 0;
    ctx.bulk_dmi_D = plan.bulk_dmi_constant;
    ctx.enable_cubic_anisotropy = plan.has_cubic_anisotropy != 0;
    ctx.cubic_Kc1 = plan.cubic_kc1;
    ctx.cubic_Kc2 = plan.cubic_kc2;
    ctx.cubic_Kc3 = plan.cubic_kc3;
    ctx.cubic_axis1 = {plan.cubic_axis1[0], plan.cubic_axis1[1], plan.cubic_axis1[2]};
    ctx.cubic_axis2 = {plan.cubic_axis2[0], plan.cubic_axis2[1], plan.cubic_axis2[2]};

    // Copy per-node spatially varying fields
    auto copy_field = [](std::vector<double> &dst, const double *src, uint64_t len) {
        if (src != nullptr && len > 0) {
            dst.assign(src, src + len);
        }
    };
    copy_field(ctx.Ms_field,    plan.ms_field,    plan.ms_field_len);
    copy_field(ctx.A_field,     plan.a_field,     plan.a_field_len);
    copy_field(ctx.alpha_field, plan.alpha_field,  plan.alpha_field_len);
    copy_field(ctx.Ku_field,    plan.ku_field,    plan.ku_field_len);
    copy_field(ctx.Ku2_field,   plan.ku2_field,   plan.ku2_field_len);
    copy_field(ctx.Dind_field,  plan.dind_field,  plan.dind_field_len);
    copy_field(ctx.Dbulk_field, plan.dbulk_field, plan.dbulk_field_len);
    copy_field(ctx.Kc1_field,   plan.kc1_field,   plan.kc1_field_len);
    copy_field(ctx.Kc2_field,   plan.kc2_field,   plan.kc2_field_len);
    copy_field(ctx.Kc3_field,   plan.kc3_field,   plan.kc3_field_len);

    ctx.material = plan.material;
    ctx.demag_solver = plan.demag_solver;

    // Adaptive time-stepping from plan
    if (plan.adaptive_config != nullptr) {
        ctx.adaptive_dt_enabled = true;
        ctx.adaptive_atol = plan.adaptive_config->atol;
        ctx.adaptive_rtol = plan.adaptive_config->rtol;
        ctx.dt_seconds = plan.adaptive_config->dt_initial > 0.0
                             ? plan.adaptive_config->dt_initial
                             : plan.dt_seconds;
        ctx.dt_min = plan.adaptive_config->dt_min;
        ctx.dt_max = plan.adaptive_config->dt_max;
        ctx.safety_factor = plan.adaptive_config->safety;
        ctx.dt_grow_max = plan.adaptive_config->growth_limit;
        ctx.dt_shrink_min = plan.adaptive_config->shrink_limit;
    }

#if FULLMAG_HAS_MFEM_STACK
    ctx.demag_realization = static_cast<int>(plan.demag_realization);
    ctx.poisson_boundary_marker = plan.poisson_boundary_marker;
#endif
    ctx.step_count = 0;
    ctx.current_time = 0.0;

    ctx.nodes_xyz.assign(
        plan.mesh.nodes_xyz,
        plan.mesh.nodes_xyz + static_cast<size_t>(ctx.n_nodes) * 3u);
    ctx.elements.assign(
        plan.mesh.elements,
        plan.mesh.elements + static_cast<size_t>(ctx.n_elements) * 4u);
    copy_optional_span(
        plan.mesh.element_markers,
        static_cast<size_t>(ctx.n_elements),
        ctx.element_markers,
        0u);
    copy_optional_span(
        plan.mesh.boundary_faces,
        static_cast<size_t>(ctx.n_boundary_faces) * 3u,
        ctx.boundary_faces,
        0u);
    copy_optional_span(
        plan.mesh.boundary_markers,
        static_cast<size_t>(ctx.n_boundary_faces),
        ctx.boundary_markers,
        0u);

    ctx.m_xyz.assign(
        plan.initial_magnetization_xyz,
        plan.initial_magnetization_xyz + static_cast<size_t>(plan.initial_magnetization_len));

    // Only copy Newell kernel spectra for transfer-grid demag (not poisson_airbox).
    if (static_cast<int>(plan.demag_realization) != 1 /* POISSON_AIRBOX */) {
        copy_optional_span(
            plan.demag_kernel_xx_spectrum,
            static_cast<size_t>(plan.demag_kernel_spectrum_len),
            ctx.transfer_grid.kernel_xx_spectrum,
            0.0);
        copy_optional_span(
            plan.demag_kernel_yy_spectrum,
            static_cast<size_t>(plan.demag_kernel_spectrum_len),
            ctx.transfer_grid.kernel_yy_spectrum,
            0.0);
        copy_optional_span(
            plan.demag_kernel_zz_spectrum,
            static_cast<size_t>(plan.demag_kernel_spectrum_len),
            ctx.transfer_grid.kernel_zz_spectrum,
            0.0);
        copy_optional_span(
            plan.demag_kernel_xy_spectrum,
            static_cast<size_t>(plan.demag_kernel_spectrum_len),
            ctx.transfer_grid.kernel_xy_spectrum,
            0.0);
        copy_optional_span(
            plan.demag_kernel_xz_spectrum,
            static_cast<size_t>(plan.demag_kernel_spectrum_len),
            ctx.transfer_grid.kernel_xz_spectrum,
            0.0);
        copy_optional_span(
            plan.demag_kernel_yz_spectrum,
            static_cast<size_t>(plan.demag_kernel_spectrum_len),
            ctx.transfer_grid.kernel_yz_spectrum,
            0.0);
    }
    // Build magnetic element mask (matches CPU: marker 1 = magnetic when
    // both marker-1 and non-marker-1 elements exist; otherwise all magnetic).
    {
        ctx.magnetic_element_mask.assign(static_cast<size_t>(ctx.n_elements), 1u);
        if (!ctx.element_markers.empty()) {
            bool has_marker_1 = false;
            bool has_other = false;
            for (size_t i = 0; i < ctx.element_markers.size(); ++i) {
                if (ctx.element_markers[i] == 1u) {
                    has_marker_1 = true;
                } else {
                    has_other = true;
                }
            }
            if (has_marker_1 && has_other) {
                for (size_t i = 0; i < ctx.element_markers.size(); ++i) {
                    ctx.magnetic_element_mask[i] =
                        ctx.element_markers[i] == 1u ? 1u : 0u;
                }
            }
        }
        // Build per-node mask: a node is magnetic if it belongs to at least
        // one magnetic element.
        ctx.magnetic_node_mask.assign(static_cast<size_t>(ctx.n_nodes), 0u);
        for (uint32_t e = 0; e < ctx.n_elements; ++e) {
            if (ctx.magnetic_element_mask[e] == 0u) {
                continue;
            }
            const size_t base = static_cast<size_t>(e) * 4u;
            for (int v = 0; v < 4; ++v) {
                ctx.magnetic_node_mask[ctx.elements[base + v]] = 1u;
            }
        }
    }

    fill_zero_vector_field(ctx.h_ex_xyz, ctx.n_nodes);
    fill_zero_vector_field(ctx.h_demag_xyz, ctx.n_nodes);
    fill_zero_vector_field(ctx.h_ani_xyz, ctx.n_nodes);
    fill_zero_vector_field(ctx.h_dmi_xyz, ctx.n_nodes);
    if (ctx.has_external_field) {
        fill_repeated_vector_field(ctx.h_ext_xyz, ctx.n_nodes, ctx.external_field_am);
        ctx.h_eff_xyz = ctx.h_ext_xyz;
    } else {
        fill_zero_vector_field(ctx.h_ext_xyz, ctx.n_nodes);
        fill_zero_vector_field(ctx.h_eff_xyz, ctx.n_nodes);
    }

    // ── Oersted field (cylindrical conductor) ──
    ctx.has_oersted_cylinder = plan.has_oersted_cylinder != 0;
    ctx.oersted_current = plan.oersted_current;
    ctx.oersted_radius = plan.oersted_radius;
    for (int i = 0; i < 3; ++i) {
        ctx.oersted_center[i] = plan.oersted_center[i];
        ctx.oersted_axis[i] = plan.oersted_axis[i];
    }
    ctx.oersted_time_dep_kind = plan.oersted_time_dep_kind;
    ctx.oersted_time_dep_freq = plan.oersted_time_dep_freq;
    ctx.oersted_time_dep_phase = plan.oersted_time_dep_phase;
    ctx.oersted_time_dep_offset = plan.oersted_time_dep_offset;
    ctx.oersted_time_dep_t_on = plan.oersted_time_dep_t_on;
    ctx.oersted_time_dep_t_off = plan.oersted_time_dep_t_off;

    if (ctx.has_oersted_cylinder && ctx.oersted_radius > 0.0) {
        // Precompute static Oersted field for I = 1 A on FEM node coordinates.
        // Ampère's law for infinite cylinder:
        //   inside (r < R):  H_phi = r / (2 pi R^2)
        //   outside (r >= R): H_phi = 1 / (2 pi r)
        const double inv_2pi = 1.0 / (2.0 * kPi);
        const double R = ctx.oersted_radius;
        const double R2 = R * R;
        const double cx = ctx.oersted_center[0];
        const double cy = ctx.oersted_center[1];

        ctx.h_oe_xyz.resize(static_cast<size_t>(ctx.n_nodes) * 3u, 0.0);
        for (uint32_t i = 0; i < ctx.n_nodes; ++i) {
            const double nx = ctx.nodes_xyz[i * 3 + 0];
            const double ny = ctx.nodes_xyz[i * 3 + 1];

            const double dx = nx - cx;
            const double dy = ny - cy;
            const double r = std::sqrt(dx * dx + dy * dy);

            double H_phi;
            if (r < 1e-30) {
                H_phi = 0.0;
            } else if (r < R) {
                H_phi = inv_2pi * r / R2;
            } else {
                H_phi = inv_2pi / r;
            }

            double sin_phi = (r < 1e-30) ? 0.0 : dy / r;
            double cos_phi = (r < 1e-30) ? 0.0 : dx / r;

            ctx.h_oe_xyz[i * 3 + 0] = -H_phi * sin_phi;
            ctx.h_oe_xyz[i * 3 + 1] =  H_phi * cos_phi;
            ctx.h_oe_xyz[i * 3 + 2] =  0.0;
        }
    }

    // ── Thermal noise (Brown field) ──
    ctx.temperature = plan.temperature;
    if (ctx.temperature > 0.0) {
        ctx.h_therm_xyz.resize(static_cast<size_t>(ctx.n_nodes) * 3u, 0.0);
    }

    context_populate_device_info(ctx);
#if FULLMAG_HAS_MFEM_STACK
    if (!context_initialize_mfem(ctx, error)) {
        return false;
    }
    // Initialize Poisson demag solver if requested
    if (ctx.enable_demag && ctx.demag_realization == 1 /* POISSON_AIRBOX */) {
        if (!context_initialize_poisson(ctx, error)) {
            return false;
        }
    }
    if ((ctx.enable_exchange || ctx.enable_demag) &&
        !context_refresh_exchange_field_mfem(ctx, error)) {
        return false;
    }
    context_populate_device_info(ctx);
#endif
    return true;
}

int context_copy_field_f64(
    const Context &ctx,
    fullmag_fem_observable observable,
    double *out_xyz,
    uint64_t out_len,
    std::string &error)
{
    if (out_xyz == nullptr) {
        error = "output field buffer pointer is null";
        return FULLMAG_FEM_ERR_INVALID;
    }

    const uint64_t expected_len = static_cast<uint64_t>(ctx.n_nodes) * 3ull;
    if (out_len != expected_len) {
        error = "output field length mismatch";
        return FULLMAG_FEM_ERR_INVALID;
    }

    const std::vector<double> *source = nullptr;
    switch (observable) {
        case FULLMAG_FEM_OBSERVABLE_M:
            source = &ctx.m_xyz;
            break;
        case FULLMAG_FEM_OBSERVABLE_H_EX:
            source = &ctx.h_ex_xyz;
            break;
        case FULLMAG_FEM_OBSERVABLE_H_DEMAG:
            source = &ctx.h_demag_xyz;
            break;
        case FULLMAG_FEM_OBSERVABLE_H_EXT:
            source = &ctx.h_ext_xyz;
            break;
        case FULLMAG_FEM_OBSERVABLE_H_EFF:
            source = &ctx.h_eff_xyz;
            break;
        case FULLMAG_FEM_OBSERVABLE_H_ANI:
            source = &ctx.h_ani_xyz;
            break;
        case FULLMAG_FEM_OBSERVABLE_H_DMI:
            source = &ctx.h_dmi_xyz;
            break;
        default:
            error = "unsupported FEM observable";
            return FULLMAG_FEM_ERR_INVALID;
    }

    std::memcpy(out_xyz, source->data(), sizeof(double) * static_cast<size_t>(out_len));
    return FULLMAG_FEM_OK;
}

int context_upload_magnetization_f64(
    Context &ctx,
    const double *m_xyz,
    uint64_t len,
    std::string &error)
{
    if (m_xyz == nullptr) {
        error = "input magnetization pointer is null";
        return FULLMAG_FEM_ERR_INVALID;
    }

    const uint64_t expected_len = static_cast<uint64_t>(ctx.n_nodes) * 3ull;
    if (len != expected_len) {
        error = "input magnetization length mismatch";
        return FULLMAG_FEM_ERR_INVALID;
    }

    ctx.m_xyz.assign(m_xyz, m_xyz + static_cast<size_t>(len));
    ctx.stepper.fsal_valid = false;
    ctx.prev_error_norm = 1.0;

#if FULLMAG_HAS_MFEM_STACK
    if ((ctx.enable_exchange || ctx.enable_demag) &&
        !context_refresh_exchange_field_mfem(ctx, error)) {
        return FULLMAG_FEM_ERR_UNAVAILABLE;
    }
#endif

    if (!ctx.enable_exchange) {
        fill_zero_vector_field(ctx.h_ex_xyz, ctx.n_nodes);
    }
    if (!ctx.enable_demag) {
        fill_zero_vector_field(ctx.h_demag_xyz, ctx.n_nodes);
    }
    if (ctx.has_external_field) {
        ctx.h_eff_xyz = ctx.h_ext_xyz;
        for (size_t i = 0; i < ctx.h_eff_xyz.size(); ++i) {
            ctx.h_eff_xyz[i] += ctx.h_ex_xyz[i] + ctx.h_demag_xyz[i];
        }
    } else {
        ctx.h_eff_xyz = ctx.h_ex_xyz;
        for (size_t i = 0; i < ctx.h_eff_xyz.size(); ++i) {
            ctx.h_eff_xyz[i] += ctx.h_demag_xyz[i];
        }
    }
    // Add Oersted field: H_eff += I(t) * h_oe_static
    if (ctx.has_oersted_cylinder && !ctx.h_oe_xyz.empty()) {
        double I_scale = ctx.oersted_current;
        switch (ctx.oersted_time_dep_kind) {
            case 1: { // Sinusoidal
                I_scale *= std::sin(2.0 * kPi * ctx.oersted_time_dep_freq * ctx.current_time
                                    + ctx.oersted_time_dep_phase)
                         + ctx.oersted_time_dep_offset;
                break;
            }
            case 2: { // Pulse
                I_scale *= (ctx.current_time >= ctx.oersted_time_dep_t_on &&
                            ctx.current_time <  ctx.oersted_time_dep_t_off) ? 1.0 : 0.0;
                break;
            }
            default: break;
        }
        for (size_t i = 0; i < ctx.h_eff_xyz.size(); ++i) {
            ctx.h_eff_xyz[i] += I_scale * ctx.h_oe_xyz[i];
        }
    }

    // Add thermal noise: H_eff += H_therm  (Brown sLLG field)
    if (ctx.temperature > 0.0 && ctx.Ms > 0.0 && ctx.current_dt > 0.0) {
        // Brown noise amplitude: sigma = sqrt(2*alpha*kB*T / (gamma0*mu0*Ms*V_node*dt))
        // where gamma0 = gamma * mu0 (FullMag stores reduced gamma = gamma0/(1+alpha^2))
        const double alpha = ctx.alpha;
        const double Ms = ctx.Ms;
        const double gamma_red = ctx.gamma;  // gamma / (1+alpha^2)
        const double gamma0 = gamma_red * (1.0 + alpha * alpha);

        // Estimate lumped node volume: total mesh volume / number of magnetic nodes
        // (For FEM this is the appropriate carrier volume for the noise amplitude)
        const uint32_t n_mag = std::max(1u, ctx.n_magnetic_nodes);
        double total_volume = 0.0;
        for (size_t e = 0; e < ctx.n_elements; ++e) {
            total_volume += ctx.element_volumes[e];
        }
        const double V_node = total_volume / static_cast<double>(n_mag);

        const double sigma = std::sqrt(
            2.0 * alpha * kB * ctx.temperature /
            (gamma0 * kMU0 * Ms * V_node * ctx.current_dt)
        );

        // Generate and add thermal noise using std::mt19937_64 + normal distribution
        // Seed: deterministic from step counter for reproducibility
        static thread_local std::mt19937_64 rng(42);
        std::normal_distribution<double> dist(0.0, sigma);
        for (size_t i = 0; i < ctx.h_eff_xyz.size(); ++i) {
            ctx.h_eff_xyz[i] += dist(rng);
        }
    }

    return FULLMAG_FEM_OK;
}

void context_populate_device_info(Context &ctx) {
    std::memset(&ctx.device_info_cache, 0, sizeof(ctx.device_info_cache));
#if FULLMAG_HAS_MFEM_STACK
    std::string backend_name = ctx.mfem_exchange_ready
        ? (ctx.enable_demag ? "mfem_cuda_transfer_grid_demag_ready" : "mfem_cuda_exchange_ready")
        : (ctx.mfem_ready ? "mfem_cuda_mesh_ready" : "mfem_stack_uninitialized");
#if FULLMAG_HAS_CUDA_RUNTIME
    if (ctx.mfem_selected_device_index >= 0) {
        cudaDeviceProp props{};
        int driver_version = 0;
        int runtime_version = 0;
        if (cudaGetDeviceProperties(&props, ctx.mfem_selected_device_index) == cudaSuccess) {
            backend_name = std::string(props.name);
            ctx.device_info_cache.compute_capability_major = props.major;
            ctx.device_info_cache.compute_capability_minor = props.minor;
        }
        if (cudaDriverGetVersion(&driver_version) == cudaSuccess) {
            ctx.device_info_cache.driver_version = driver_version;
        }
        if (cudaRuntimeGetVersion(&runtime_version) == cudaSuccess) {
            ctx.device_info_cache.runtime_version = runtime_version;
        }
    }
#endif
    std::strncpy(
        ctx.device_info_cache.name,
        backend_name.c_str(),
        sizeof(ctx.device_info_cache.name) - 1);
    ctx.device_info_cache.is_gpu_enabled = 1;
#else
    std::strncpy(
        ctx.device_info_cache.name,
        "native_fem_scaffold",
        sizeof(ctx.device_info_cache.name) - 1);
    ctx.device_info_cache.is_gpu_enabled = 0;
#endif
    ctx.device_info_valid = true;
}

} // namespace fullmag::fem
