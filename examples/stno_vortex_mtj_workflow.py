#!/usr/bin/env python3
"""
STNO/MTJ Vortex Oscillator — Complete Workflow Example
======================================================

This script demonstrates the full simulation pipeline for a vortex-based
spin-torque nano-oscillator (STNO) using a magnetic tunnel junction (MTJ)
geometry.

Physical system:
    - Nanopillar diameter: 400 nm
    - Free layer: CoFeB(2 nm) / NiFe(7 nm) composite  →  effective 9 nm
    - Reference layer polarization: along +x
    - Ground state: magnetic vortex

Simulation stages:
    1. Relax vortex state (no STT, no temperature)
    2. Oersted field excitation (AC sinusoidal)
    3. Slonczewski STT drive (CPP geometry)
    4. Post-processing: FFT, PSD, vortex core tracking

Based on the diagnostic and implementation reports:
    fullmag_stno_mtj_raport_diagnostyczny.mdx
    fullmag_stno_mtj_raport_wdrozeniowy.mdx
"""

from fullmag.init.textures import texture
from fullmag.model.discretization import DiscretizationHints, FDM
from fullmag.model.dynamics import LLG, AdaptiveTimestep
from fullmag.model.energy import (
    Demag,
    Exchange,
    OerstedCylinder,
    Sinusoidal,
    UniaxialAnisotropy,
)
from fullmag.model.geometry import Cylinder
from fullmag.model.outputs import SaveField, SaveScalar, Snapshot
from fullmag.model.problem import (
    BackendTarget,
    ExecutionPrecision,
    Problem,
    RuntimeSelection,
)
from fullmag.model.spin_torque import SlonczewskiSTT
from fullmag.model.structure import Ferromagnet, Material
from fullmag.model.study import Relaxation, TimeEvolution

# ─────────────────────────────────────────────────────────────────────
# Material parameters
# ─────────────────────────────────────────────────────────────────────

# Effective free layer: CoFeB(2nm)/NiFe(7nm) composite
# Using volume-weighted effective parameters
mat_free = Material(
    name="CoFeB_NiFe_eff",
    Ms=700e3,       # A/m — weighted average
    A=1.2e-11,      # J/m — weighted effective exchange
    alpha=0.01,     # Gilbert damping
    Ku1=5e3,        # J/m³ — small effective interfacial anisotropy from CoFeB
    anisU=(0, 0, 1),  # out-of-plane easy axis (interfacial contribution)
)

# ─────────────────────────────────────────────────────────────────────
# Geometry
# ─────────────────────────────────────────────────────────────────────

disk = Cylinder(radius=200e-9, height=9e-9, name="free_disk")

# ─────────────────────────────────────────────────────────────────────
# Magnet with vortex initial state
# ─────────────────────────────────────────────────────────────────────

free_layer = Ferromagnet(
    name="free",
    geometry=disk,
    material=mat_free,
    m0=texture.vortex(circulation=+1, core_polarity=+1),
)

# ─────────────────────────────────────────────────────────────────────
# Runtime and discretization
# ─────────────────────────────────────────────────────────────────────

runtime = RuntimeSelection(
    backend_target=BackendTarget.FDM,
    execution_precision=ExecutionPrecision.DOUBLE,
)

disc = DiscretizationHints(
    fdm=FDM(default_cell=(4e-9, 4e-9, 1e-9)),
)

# ─────────────────────────────────────────────────────────────────────
# Common output specifications
# ─────────────────────────────────────────────────────────────────────

scalar_outputs = [
    SaveScalar(scalar="mx", every=10e-12),
    SaveScalar(scalar="my", every=10e-12),
    SaveScalar(scalar="mz", every=10e-12),
    SaveScalar(scalar="E_total", every=100e-12),
    SaveScalar(scalar="E_ex", every=100e-12),
    SaveScalar(scalar="E_demag", every=100e-12),
    SaveScalar(scalar="time", every=10e-12),
    SaveScalar(scalar="max_dm_dt", every=10e-12),
]

snapshot_outputs = [
    Snapshot(field="m", component="z", every=1e-9, layer=None),
]

# ═════════════════════════════════════════════════════════════════════
# Stage 1: Relax to vortex equilibrium
# ═════════════════════════════════════════════════════════════════════

relax_problem = Problem(
    name="stno_vortex_relax",
    description="Relax 400nm disk to vortex ground state",
    magnets=[free_layer],
    energy=[Exchange(), Demag(), UniaxialAnisotropy(ku1=5e3, axis=(0, 0, 1))],
    study=Relaxation(
        outputs=[
            SaveScalar(scalar="E_total", every=100e-12),
            SaveScalar(scalar="max_dm_dt", every=100e-12),
            Snapshot(field="m", component="3D", every=5e-9),
        ],
        torque_tolerance=1e-5,
        max_steps=100_000,
    ),
    discretization=disc,
    runtime=runtime,
)

# ═════════════════════════════════════════════════════════════════════
# Stage 2: Time evolution with Oersted field excitation
# ═════════════════════════════════════════════════════════════════════

# AC Oersted field from nanopillar current
# Sinusoidal excitation near expected gyrotropic frequency (~150 MHz for 400nm disk)
oersted_ac = OerstedCylinder(
    current=1e-3,           # 1 mA AC amplitude
    radius=200e-9,          # same as disk radius
    center=(0, 0, 0),
    axis=(0, 0, 1),
    time_dependence=Sinusoidal(
        frequency_hz=150e6,  # 150 MHz — near expected f_gyro
        phase_rad=0.0,
        offset=0.0,
    ),
)

drive_oersted_problem = Problem(
    name="stno_vortex_oersted_drive",
    description="Excite vortex gyrotropic mode via AC Oersted field",
    magnets=[free_layer],
    energy=[
        Exchange(),
        Demag(),
        UniaxialAnisotropy(ku1=5e3, axis=(0, 0, 1)),
        oersted_ac,
    ],
    study=TimeEvolution(
        dynamics=LLG(
            integrator="rk45",
            adaptive_timestep=AdaptiveTimestep(
                atol=1e-6,
                rtol=1e-6,
                dt_initial=1e-14,
                dt_max=1e-12,
            ),
        ),
        outputs=[
            *scalar_outputs,
            *snapshot_outputs,
            Snapshot(field="m", component="3D", every=0.5e-9),
        ],
    ),
    discretization=disc,
    runtime=runtime,
)

# ═════════════════════════════════════════════════════════════════════
# Stage 3: STT-driven auto-oscillation (Slonczewski CPP)
# ═════════════════════════════════════════════════════════════════════

stt = SlonczewskiSTT(
    current_density=(0, 0, 5e10),    # J = 5×10¹⁰ A/m² along +z (CPP)
    spin_polarization=(1, 0, 0),     # reference layer along +x
    degree=0.4,                       # P = 0.4
    lambda_asymmetry=1.0,            # Λ = 1.0 (symmetric Slonczewski)
    epsilon_prime=0.0,               # no field-like correction
)

# DC Oersted from bias current (always-on)
oersted_dc = OerstedCylinder(
    current=0.5e-3,       # 0.5 mA DC bias
    radius=200e-9,
    center=(0, 0, 0),
    axis=(0, 0, 1),
)

stt_drive_problem = Problem(
    name="stno_vortex_stt_autooscillation",
    description="Slonczewski STT-driven vortex auto-oscillation",
    magnets=[free_layer],
    energy=[
        Exchange(),
        Demag(),
        UniaxialAnisotropy(ku1=5e3, axis=(0, 0, 1)),
        oersted_dc,
    ],
    spin_torque=stt,
    temperature=None,  # no thermal noise initially
    study=TimeEvolution(
        dynamics=LLG(
            integrator="rk45",
            adaptive_timestep=AdaptiveTimestep(
                atol=1e-6,
                rtol=1e-6,
                dt_initial=1e-14,
                dt_max=1e-12,
            ),
        ),
        outputs=[
            *scalar_outputs,
            *snapshot_outputs,
            SaveField(field="m", every=0.2e-9),
        ],
    ),
    discretization=disc,
    runtime=runtime,
)

# ═════════════════════════════════════════════════════════════════════
# Stage 4: STT + Temperature (for linewidth)
# ═════════════════════════════════════════════════════════════════════

stt_thermal_problem = Problem(
    name="stno_vortex_stt_thermal",
    description="STT-driven oscillation with thermal noise (T=300K)",
    magnets=[free_layer],
    energy=[
        Exchange(),
        Demag(),
        UniaxialAnisotropy(ku1=5e3, axis=(0, 0, 1)),
        oersted_dc,
    ],
    spin_torque=stt,
    temperature=300.0,  # room temperature
    study=TimeEvolution(
        dynamics=LLG(
            integrator="rk45",
            adaptive_timestep=AdaptiveTimestep(
                atol=1e-6,
                rtol=1e-6,
                dt_initial=1e-14,
                dt_max=1e-12,
            ),
        ),
        outputs=[
            *scalar_outputs,
            *snapshot_outputs,
        ],
    ),
    discretization=disc,
    runtime=runtime,
)

# ═════════════════════════════════════════════════════════════════════
# Post-Processing Example (offline, after simulation completes)
# ═════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    import numpy as np

    print("=" * 70)
    print("STNO/MTJ Vortex Oscillator Workflow")
    print("=" * 70)

    # Validate all problems serialize correctly
    for prob in [relax_problem, drive_oersted_problem, stt_drive_problem, stt_thermal_problem]:
        ir = prob.to_ir()
        print(f"  ✓ {prob.name} → IR serialized ({len(ir)} top-level keys)")

    # Check STT fields appear in IR
    ir_stt = stt_drive_problem.to_ir()
    assert ir_stt.get("current_density") == [0, 0, 5e10], "STT current_density not in IR"
    assert ir_stt.get("stt_degree") == 0.4, "stt_degree not in IR"
    assert ir_stt.get("stt_spin_polarization") == [1, 0, 0], "stt_spin_polarization not in IR"
    assert ir_stt.get("stt_lambda") == 1.0, "stt_lambda not in IR"
    assert ir_stt.get("stt_epsilon_prime") == 0.0, "stt_epsilon_prime not in IR"
    print("  ✓ STT fields correctly serialized in IR")

    # Check temperature in thermal problem
    ir_thermal = stt_thermal_problem.to_ir()
    assert ir_thermal.get("temperature") == 300.0, "temperature not in IR"
    print("  ✓ Temperature correctly serialized in IR")

    # ── Demonstrate post-processing (with synthetic data) ──
    print("\n── Post-processing demonstration (synthetic data) ──")

    from fullmag.analysis.spectrum import linewidth_lorentzian, peak_frequency, psd_from_trace
    from fullmag.analysis.vortex import core_orbit_radius, core_phase, track_vortex_core

    # Synthetic time trace: damped oscillation at 150 MHz
    dt = 10e-12  # 10 ps sampling
    t = np.arange(0, 100e-9, dt)
    f_gyro = 150e6
    mx = 0.1 * np.sin(2 * np.pi * f_gyro * t) * np.exp(-t / 50e-9) + np.random.normal(0, 0.001, len(t))
    my = 0.1 * np.cos(2 * np.pi * f_gyro * t) * np.exp(-t / 50e-9) + np.random.normal(0, 0.001, len(t))

    # PSD analysis
    freqs, psd = psd_from_trace(t, mx, discard_transient=5e-9)
    f_peak = peak_frequency(freqs, psd, fmin=50e6, fmax=500e6)
    print(f"  Peak frequency: {f_peak / 1e6:.1f} MHz (expected: {f_gyro / 1e6:.0f} MHz)")

    # Linewidth
    lw = linewidth_lorentzian(freqs, psd, fmin=50e6, fmax=500e6)
    print(f"  FWHM linewidth: {lw['fwhm'] / 1e6:.2f} MHz")

    # Vortex core tracking (synthetic 2D data)
    n_cells = 100
    x = np.linspace(-200e-9, 200e-9, n_cells)
    y = np.linspace(-200e-9, 200e-9, n_cells)
    xx, yy = np.meshgrid(x, y)
    # Simulate mz with a Gaussian core at offset position
    core_x0, core_y0 = 10e-9, -5e-9
    core_w = 10e-9
    mz = np.exp(-((xx - core_x0) ** 2 + (yy - core_y0) ** 2) / (2 * core_w ** 2))
    xc, yc = track_vortex_core(mz.ravel(), xx.ravel(), yy.ravel(), power=4)
    print(f"  Tracked core: ({xc * 1e9:.1f}, {yc * 1e9:.1f}) nm"
          f" (expected: ({core_x0 * 1e9:.0f}, {core_y0 * 1e9:.0f}) nm)")

    # Orbit analysis (synthetic circular orbit)
    t_orbit = np.linspace(0, 50e-9, 500)
    orbit_r = 15e-9
    xc_t = orbit_r * np.cos(2 * np.pi * f_gyro * t_orbit)
    yc_t = orbit_r * np.sin(2 * np.pi * f_gyro * t_orbit)
    r_orbit = core_orbit_radius(xc_t, yc_t)
    phi = core_phase(xc_t, yc_t)
    print(f"  Orbit radius: {np.mean(r_orbit) * 1e9:.1f} nm (expected: {orbit_r * 1e9:.0f} nm)")
    print(f"  Phase range: {phi[0]:.2f} → {phi[-1]:.2f} rad")

    print("\n✓ All validation and post-processing completed successfully")
