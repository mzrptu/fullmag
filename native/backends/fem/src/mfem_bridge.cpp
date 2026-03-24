#include "context.hpp"

#include <mfem.hpp>

#include <algorithm>
#include <cmath>

namespace fullmag::fem {

namespace {

constexpr double kMu0 = 4.0e-7 * 3.14159265358979323846;

void unpack_aos_to_components(
    const std::vector<double> &aos,
    std::vector<double> &x,
    std::vector<double> &y,
    std::vector<double> &z)
{
    const size_t n = aos.size() / 3u;
    x.resize(n);
    y.resize(n);
    z.resize(n);
    for (size_t i = 0; i < n; ++i) {
        x[i] = aos[i * 3u + 0];
        y[i] = aos[i * 3u + 1];
        z[i] = aos[i * 3u + 2];
    }
}

void unpack_aos_to_existing_components(
    const std::vector<double> &aos,
    std::vector<double> &x,
    std::vector<double> &y,
    std::vector<double> &z)
{
    const size_t n = aos.size() / 3u;
    if (x.size() != n || y.size() != n || z.size() != n) {
        unpack_aos_to_components(aos, x, y, z);
        return;
    }
    for (size_t i = 0; i < n; ++i) {
        x[i] = aos[i * 3u + 0];
        y[i] = aos[i * 3u + 1];
        z[i] = aos[i * 3u + 2];
    }
}

void pack_components_to_aos(
    const std::vector<double> &x,
    const std::vector<double> &y,
    const std::vector<double> &z,
    std::vector<double> &aos)
{
    const size_t n = x.size();
    aos.resize(n * 3u);
    for (size_t i = 0; i < n; ++i) {
        aos[i * 3u + 0] = x[i];
        aos[i * 3u + 1] = y[i];
        aos[i * 3u + 2] = z[i];
    }
}

bool is_fully_magnetic(const Context &ctx) {
    if (ctx.element_markers.empty()) {
        return true;
    }
    const uint32_t first = ctx.element_markers.front();
    return std::all_of(
        ctx.element_markers.begin(),
        ctx.element_markers.end(),
        [first](uint32_t marker) { return marker == first; });
}

void compute_row_sum_lumped_mass(const mfem::SparseMatrix &matrix, std::vector<double> &lumped) {
    const int n = matrix.Height();
    lumped.assign(static_cast<size_t>(n), 0.0);
    const int *I = matrix.GetI();
    const double *data = matrix.GetData();
    for (int row = 0; row < n; ++row) {
        double sum = 0.0;
        for (int index = I[row]; index < I[row + 1]; ++index) {
            sum += data[index];
        }
        lumped[static_cast<size_t>(row)] = sum;
    }
}

bool apply_exchange_component(
    const mfem::SparseMatrix &stiffness,
    const std::vector<double> &lumped_mass,
    double prefactor,
    mfem::GridFunction &m_component,
    std::vector<double> &h_component,
    std::string &error)
{
    mfem::Vector tmp(m_component.Size());
    stiffness.Mult(m_component, tmp);
    h_component.resize(static_cast<size_t>(tmp.Size()));
    for (int i = 0; i < tmp.Size(); ++i) {
        const double mass = lumped_mass[static_cast<size_t>(i)];
        if (mass <= 0.0) {
            error = "encountered non-positive lumped FEM mass while building exchange field";
            return false;
        }
        h_component[static_cast<size_t>(i)] = -prefactor * tmp[i] / mass;
    }
    return true;
}

double vector_norm3(double x, double y, double z) {
    return std::sqrt(x * x + y * y + z * z);
}

void normalize_aos_field(std::vector<double> &m_xyz) {
    const size_t n = m_xyz.size() / 3u;
    for (size_t i = 0; i < n; ++i) {
        const size_t base = i * 3u;
        const double norm = vector_norm3(m_xyz[base + 0], m_xyz[base + 1], m_xyz[base + 2]);
        if (norm > 0.0) {
            m_xyz[base + 0] /= norm;
            m_xyz[base + 1] /= norm;
            m_xyz[base + 2] /= norm;
        }
    }
}

void llg_rhs_aos(
    const std::vector<double> &m_xyz,
    const std::vector<double> &h_xyz,
    double gamma,
    double alpha,
    std::vector<double> &rhs_xyz,
    double &max_rhs)
{
    const double gamma_bar = gamma / (1.0 + alpha * alpha);
    const size_t n = m_xyz.size() / 3u;
    rhs_xyz.resize(m_xyz.size());
    max_rhs = 0.0;

    for (size_t i = 0; i < n; ++i) {
        const size_t base = i * 3u;
        const double mx = m_xyz[base + 0];
        const double my = m_xyz[base + 1];
        const double mz = m_xyz[base + 2];
        const double hx = h_xyz[base + 0];
        const double hy = h_xyz[base + 1];
        const double hz = h_xyz[base + 2];

        const double px = my * hz - mz * hy;
        const double py = mz * hx - mx * hz;
        const double pz = mx * hy - my * hx;

        const double dx = my * pz - mz * py;
        const double dy = mz * px - mx * pz;
        const double dz = mx * py - my * px;

        rhs_xyz[base + 0] = -gamma_bar * (px + alpha * dx);
        rhs_xyz[base + 1] = -gamma_bar * (py + alpha * dy);
        rhs_xyz[base + 2] = -gamma_bar * (pz + alpha * dz);

        max_rhs = std::max(
            max_rhs,
            vector_norm3(rhs_xyz[base + 0], rhs_xyz[base + 1], rhs_xyz[base + 2]));
    }
}

double max_norm_aos(const std::vector<double> &field_xyz) {
    double max_value = 0.0;
    const size_t n = field_xyz.size() / 3u;
    for (size_t i = 0; i < n; ++i) {
        const size_t base = i * 3u;
        max_value = std::max(
            max_value,
            vector_norm3(field_xyz[base + 0], field_xyz[base + 1], field_xyz[base + 2]));
    }
    return max_value;
}

double external_energy_from_field(
    const Context &ctx,
    const std::vector<double> &m_xyz)
{
    if (!ctx.has_external_field) {
        return 0.0;
    }

    double energy = 0.0;
    for (size_t i = 0; i < ctx.mfem_lumped_mass.size(); ++i) {
        const size_t base = i * 3u;
        const double mdoth =
            m_xyz[base + 0] * ctx.h_ext_xyz[base + 0] +
            m_xyz[base + 1] * ctx.h_ext_xyz[base + 1] +
            m_xyz[base + 2] * ctx.h_ext_xyz[base + 2];
        energy += -kMu0 * ctx.material.saturation_magnetisation * mdoth * ctx.mfem_lumped_mass[i];
    }
    return energy;
}

double exchange_energy_from_components(
    const mfem::SparseMatrix &stiffness,
    const std::vector<double> &mx,
    const std::vector<double> &my,
    const std::vector<double> &mz,
    double exchange_stiffness)
{
    mfem::Vector vx(const_cast<double *>(mx.data()), static_cast<int>(mx.size()));
    mfem::Vector vy(const_cast<double *>(my.data()), static_cast<int>(my.size()));
    mfem::Vector vz(const_cast<double *>(mz.data()), static_cast<int>(mz.size()));
    mfem::Vector tmp(static_cast<int>(mx.size()));

    double energy = 0.0;
    stiffness.Mult(vx, tmp);
    energy += exchange_stiffness * (vx * tmp);
    stiffness.Mult(vy, tmp);
    energy += exchange_stiffness * (vy * tmp);
    stiffness.Mult(vz, tmp);
    energy += exchange_stiffness * (vz * tmp);
    return energy;
}

bool compute_exchange_for_magnetization(
    Context &ctx,
    const std::vector<double> &m_xyz,
    std::vector<double> &h_ex_xyz,
    std::vector<double> *h_eff_xyz,
    double *exchange_energy,
    std::string &error)
{
    if (!ctx.mfem_ready) {
        error = "MFEM exchange requested before MFEM context initialization";
        return false;
    }
    if (!is_fully_magnetic(ctx)) {
        error =
            "native MFEM exchange scaffold currently supports only fully magnetic meshes (single material marker)";
        return false;
    }

    auto *exchange_form = static_cast<mfem::BilinearForm *>(ctx.mfem_exchange_form);
    auto *mass_form = static_cast<mfem::BilinearForm *>(ctx.mfem_mass_form);
    auto *gf_mx = static_cast<mfem::GridFunction *>(ctx.mfem_gf_mx);
    auto *gf_my = static_cast<mfem::GridFunction *>(ctx.mfem_gf_my);
    auto *gf_mz = static_cast<mfem::GridFunction *>(ctx.mfem_gf_mz);
    if (exchange_form == nullptr || mass_form == nullptr || gf_mx == nullptr || gf_my == nullptr ||
        gf_mz == nullptr) {
        error = "MFEM exchange scaffold is missing one or more assembled objects";
        return false;
    }

    unpack_aos_to_existing_components(m_xyz, ctx.mfem_mx, ctx.mfem_my, ctx.mfem_mz);

    const auto &stiffness = exchange_form->SpMat();
    const auto &mass = mass_form->SpMat();
    if (ctx.mfem_lumped_mass.empty()) {
        compute_row_sum_lumped_mass(mass, ctx.mfem_lumped_mass);
    }

    const double prefactor = 2.0 * ctx.material.exchange_stiffness /
                             (kMu0 * ctx.material.saturation_magnetisation);

    if (!apply_exchange_component(
            stiffness, ctx.mfem_lumped_mass, prefactor, *gf_mx, ctx.mfem_h_ex_x, error) ||
        !apply_exchange_component(
            stiffness, ctx.mfem_lumped_mass, prefactor, *gf_my, ctx.mfem_h_ex_y, error) ||
        !apply_exchange_component(
            stiffness, ctx.mfem_lumped_mass, prefactor, *gf_mz, ctx.mfem_h_ex_z, error)) {
        return false;
    }

    pack_components_to_aos(ctx.mfem_h_ex_x, ctx.mfem_h_ex_y, ctx.mfem_h_ex_z, h_ex_xyz);
    if (h_eff_xyz != nullptr) {
        h_eff_xyz->resize(h_ex_xyz.size());
        if (ctx.has_external_field) {
            for (size_t i = 0; i < h_ex_xyz.size(); ++i) {
                (*h_eff_xyz)[i] = h_ex_xyz[i] + ctx.h_ext_xyz[i];
            }
        } else {
            *h_eff_xyz = h_ex_xyz;
        }
    }

    if (exchange_energy != nullptr) {
        *exchange_energy = exchange_energy_from_components(
            stiffness,
            ctx.mfem_mx,
            ctx.mfem_my,
            ctx.mfem_mz,
            ctx.material.exchange_stiffness);
    }

    return true;
}

} // namespace

bool context_initialize_mfem(Context &ctx, std::string &error) {
    try {
        auto *mesh = new mfem::Mesh(3, static_cast<int>(ctx.n_nodes), static_cast<int>(ctx.n_elements),
                                    static_cast<int>(ctx.n_boundary_faces), 3);

        for (uint32_t i = 0; i < ctx.n_nodes; ++i) {
            const double *coords = ctx.nodes_xyz.data() + static_cast<size_t>(i) * 3u;
            mesh->AddVertex(coords);
        }

        for (uint32_t i = 0; i < ctx.n_elements; ++i) {
            const int *ignored = nullptr;
            (void)ignored;
            const uint32_t *tet = ctx.elements.data() + static_cast<size_t>(i) * 4u;
            const int vi[4] = {
                static_cast<int>(tet[0]),
                static_cast<int>(tet[1]),
                static_cast<int>(tet[2]),
                static_cast<int>(tet[3]),
            };
            const int attr = ctx.element_markers.empty()
                ? 1
                : static_cast<int>(ctx.element_markers[static_cast<size_t>(i)]);
            mesh->AddTet(vi, attr);
        }

        for (uint32_t i = 0; i < ctx.n_boundary_faces; ++i) {
            const uint32_t *tri = ctx.boundary_faces.data() + static_cast<size_t>(i) * 3u;
            const int vi[3] = {
                static_cast<int>(tri[0]),
                static_cast<int>(tri[1]),
                static_cast<int>(tri[2]),
            };
            const int attr = ctx.boundary_markers.empty()
                ? 1
                : static_cast<int>(ctx.boundary_markers[static_cast<size_t>(i)]);
            mesh->AddBdrTriangle(vi, attr);
        }

        mesh->FinalizeTopology();
        mesh->Finalize(false, true);

        auto *fec = new mfem::H1_FECollection(static_cast<int>(ctx.fe_order), mesh->Dimension());
        auto *fes = new mfem::FiniteElementSpace(mesh, fec);

        if (fes->GetNDofs() != static_cast<int>(ctx.n_nodes)) {
            error = "MFEM H1 P1 space DOF count does not match node count";
            delete fes;
            delete fec;
            delete mesh;
            return false;
        }

        unpack_aos_to_components(ctx.m_xyz, ctx.mfem_mx, ctx.mfem_my, ctx.mfem_mz);
        auto *gf_mx = new mfem::GridFunction(fes, ctx.mfem_mx.data());
        auto *gf_my = new mfem::GridFunction(fes, ctx.mfem_my.data());
        auto *gf_mz = new mfem::GridFunction(fes, ctx.mfem_mz.data());

        auto *exchange_form = new mfem::BilinearForm(fes);
        exchange_form->AddDomainIntegrator(new mfem::DiffusionIntegrator());
        exchange_form->Assemble();
        exchange_form->Finalize();

        auto *mass_form = new mfem::BilinearForm(fes);
        mass_form->AddDomainIntegrator(new mfem::MassIntegrator());
        mass_form->Assemble();
        mass_form->Finalize();

        ctx.mfem_mesh = mesh;
        ctx.mfem_fec = fec;
        ctx.mfem_fes = fes;
        ctx.mfem_gf_mx = gf_mx;
        ctx.mfem_gf_my = gf_my;
        ctx.mfem_gf_mz = gf_mz;
        ctx.mfem_exchange_form = exchange_form;
        ctx.mfem_mass_form = mass_form;
        ctx.mfem_ready = true;
        return true;
    } catch (const std::exception &ex) {
        error = std::string("MFEM mesh/space initialization failed: ") + ex.what();
    } catch (...) {
        error = "MFEM mesh/space initialization failed with an unknown error";
    }

    context_destroy_mfem(ctx);
    return false;
}

void context_destroy_mfem(Context &ctx) {
    delete static_cast<mfem::BilinearForm *>(ctx.mfem_mass_form);
    delete static_cast<mfem::BilinearForm *>(ctx.mfem_exchange_form);
    delete static_cast<mfem::GridFunction *>(ctx.mfem_gf_mz);
    delete static_cast<mfem::GridFunction *>(ctx.mfem_gf_my);
    delete static_cast<mfem::GridFunction *>(ctx.mfem_gf_mx);
    delete static_cast<mfem::FiniteElementSpace *>(ctx.mfem_fes);
    delete static_cast<mfem::FiniteElementCollection *>(ctx.mfem_fec);
    delete static_cast<mfem::Mesh *>(ctx.mfem_mesh);
    ctx.mfem_mass_form = nullptr;
    ctx.mfem_exchange_form = nullptr;
    ctx.mfem_gf_mz = nullptr;
    ctx.mfem_gf_my = nullptr;
    ctx.mfem_gf_mx = nullptr;
    ctx.mfem_fes = nullptr;
    ctx.mfem_fec = nullptr;
    ctx.mfem_mesh = nullptr;
    ctx.mfem_ready = false;
    ctx.mfem_exchange_ready = false;
}

bool context_refresh_exchange_field_mfem(Context &ctx, std::string &error) {
    if (!compute_exchange_for_magnetization(
            ctx, ctx.m_xyz, ctx.h_ex_xyz, &ctx.h_eff_xyz, nullptr, error)) {
        return false;
    }
    ctx.mfem_exchange_ready = true;
    return true;
}

bool context_step_exchange_heun_mfem(
    Context &ctx,
    double dt_seconds,
    fullmag_fem_step_stats &stats,
    std::string &error)
{
    if (!ctx.mfem_ready) {
        error = "MFEM step requested before MFEM context initialization";
        return false;
    }
    if (ctx.enable_demag) {
        error = "native FEM GPU exchange stepper does not support demag yet";
        return false;
    }
    if (!ctx.enable_exchange) {
        error = "native FEM GPU stepper currently requires exchange to be enabled";
        return false;
    }
    if (dt_seconds <= 0.0) {
        error = "native FEM GPU stepper requires a positive dt";
        return false;
    }

    std::vector<double> h_ex_now;
    std::vector<double> h_eff_now;
    double exchange_energy = 0.0;
    if (!compute_exchange_for_magnetization(
            ctx, ctx.m_xyz, h_ex_now, &h_eff_now, &exchange_energy, error)) {
        return false;
    }

    std::vector<double> k1;
    double max_rhs_k1 = 0.0;
    llg_rhs_aos(
        ctx.m_xyz,
        h_eff_now,
        ctx.material.gyromagnetic_ratio,
        ctx.material.damping,
        k1,
        max_rhs_k1);

    std::vector<double> predicted = ctx.m_xyz;
    for (size_t i = 0; i < predicted.size(); ++i) {
        predicted[i] += dt_seconds * k1[i];
    }
    normalize_aos_field(predicted);

    std::vector<double> h_ex_pred;
    std::vector<double> h_eff_pred;
    if (!compute_exchange_for_magnetization(
            ctx, predicted, h_ex_pred, &h_eff_pred, nullptr, error)) {
        return false;
    }

    std::vector<double> k2;
    double max_rhs_k2 = 0.0;
    llg_rhs_aos(
        predicted,
        h_eff_pred,
        ctx.material.gyromagnetic_ratio,
        ctx.material.damping,
        k2,
        max_rhs_k2);

    std::vector<double> corrected = ctx.m_xyz;
    for (size_t i = 0; i < corrected.size(); ++i) {
        corrected[i] += 0.5 * dt_seconds * (k1[i] + k2[i]);
    }
    normalize_aos_field(corrected);

    std::vector<double> h_ex_final;
    std::vector<double> h_eff_final;
    double exchange_energy_final = 0.0;
    if (!compute_exchange_for_magnetization(
            ctx, corrected, h_ex_final, &h_eff_final, &exchange_energy_final, error)) {
        return false;
    }

    ctx.m_xyz = std::move(corrected);
    ctx.h_ex_xyz = std::move(h_ex_final);
    ctx.h_eff_xyz = std::move(h_eff_final);
    ctx.h_demag_xyz.assign(ctx.m_xyz.size(), 0.0);
    ctx.current_time += dt_seconds;
    ctx.step_count += 1;
    ctx.mfem_exchange_ready = true;

    stats.step = ctx.step_count;
    stats.time_seconds = ctx.current_time;
    stats.dt_seconds = dt_seconds;
    stats.exchange_energy_joules = exchange_energy_final;
    stats.demag_energy_joules = 0.0;
    stats.external_energy_joules = external_energy_from_field(ctx, ctx.m_xyz);
    stats.total_energy_joules =
        stats.exchange_energy_joules + stats.demag_energy_joules + stats.external_energy_joules;
    stats.max_effective_field_amplitude = max_norm_aos(ctx.h_eff_xyz);
    stats.max_demag_field_amplitude = 0.0;
    stats.max_rhs_amplitude = std::max(max_rhs_k1, max_rhs_k2);
    stats.demag_linear_iterations = 0;
    stats.demag_linear_residual = 0.0;
    stats.wall_time_ns = 0;

    return true;
}

} // namespace fullmag::fem
