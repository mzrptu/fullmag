"use client";

import { useState } from "react";
import s from "./SolverSettingsPanel.module.css";

/* ── Types ─────────────────────────────────────────────────── */

export interface SolverSettingsState {
  /** Time integrator algorithm for LLG stepping. */
  integrator: string;
  /** Fixed timestep in seconds (empty string = auto/adaptive). */
  fixedTimestep: string;
  /** Relaxation algorithm selection. */
  relaxAlgorithm: string;
  /** Torque convergence tolerance for relaxation (T). */
  torqueTolerance: string;
  /** Energy convergence tolerance for relaxation (J). Empty = disabled. */
  energyTolerance: string;
  /** Maximum relaxation steps. */
  maxRelaxSteps: string;
  /** Gilbert damping parameter α for relaxation (overrides material α). */
  relaxAlpha: string;
}

export const DEFAULT_SOLVER_SETTINGS: SolverSettingsState = {
  integrator: "rk45",
  fixedTimestep: "",
  relaxAlgorithm: "llg_overdamped",
  torqueTolerance: "1e-6",
  energyTolerance: "",
  maxRelaxSteps: "5000",
  relaxAlpha: "",
};

interface SolverSettingsPanelProps {
  settings: SolverSettingsState;
  onChange: (next: SolverSettingsState) => void;
  /** Whether solver is currently running — disables mutation. */
  solverRunning?: boolean;
  /** Workspace is in interactive mode and awaiting a command. */
  awaitingCommand?: boolean;
  /** Callback: apply solver settings to the next run/relax command. */
  onApply?: () => void;
}

/* ── Algorithm options ─────────────────────────────────────── */

const INTEGRATOR_OPTIONS = [
  { value: "heun", label: "Heun (RK2)", desc: "2nd-order explicit, fixed step. Fast, basic accuracy." },
  { value: "rk4", label: "RK4", desc: "Classic 4th-order Runge–Kutta. Good balance of speed and accuracy." },
  { value: "rk23", label: "RK2(3) Adaptive", desc: "Embedded 2nd/3rd-order pair with automatic timestep control." },
  { value: "rk45", label: "RK4(5) Adaptive", desc: "Dormand–Prince embedded pair. High accuracy, adaptive Δt." },
  { value: "abm3", label: "ABM3", desc: "Adams–Bashforth–Moulton 3rd-order multistep. Efficient for smooth dynamics." },
];

const RELAX_ALGORITHM_OPTIONS = [
  { value: "llg_overdamped", label: "LLG Overdamped", desc: "Standard time-stepping with high damping (α≈1). Safe, always converges. Works on FDM and FEM." },
  { value: "projected_gradient_bb", label: "Projected Gradient (BB)", desc: "Barzilai–Borwein steepest descent on the sphere manifold with Armijo backtracking. Fast convergence, FDM only." },
  { value: "nonlinear_cg", label: "Nonlinear CG", desc: "Polak–Ribière+ conjugate gradient with tangent-space transport. OOMMF-quality, FDM only." },
  { value: "tangent_plane_implicit", label: "Tangent Plane Implicit", desc: "Linearly implicit tangent-plane scheme. FEM only, not yet available." },
];

/* ── Tooltip ─────────────────────────────────────────────────  */

function HelpTip({ text }: { text: string }) {
  return (
    <span className={s.helpTip} title={text}>
      ?
    </span>
  );
}

/* ── Component ─────────────────────────────────────────────── */

export default function SolverSettingsPanel({
  settings,
  onChange,
  solverRunning = false,
  awaitingCommand = false,
  onApply,
}: SolverSettingsPanelProps) {
  const disabled = solverRunning;
  const canApply = awaitingCommand && !solverRunning;

  const update = (patch: Partial<SolverSettingsState>) =>
    onChange({ ...settings, ...patch });

  const selectedIntegrator = INTEGRATOR_OPTIONS.find((o) => o.value === settings.integrator);
  const selectedRelax = RELAX_ALGORITHM_OPTIONS.find((o) => o.value === settings.relaxAlgorithm);

  return (
    <div className={s.root}>
      {/* ── Time Integration ── */}
      <div className={s.section}>
        <div className={s.sectionHeader}>
          <span className={s.sectionTitle}>Time Integration</span>
          <HelpTip text="Controls how the LLG equation is stepped forward in time. Adaptive integrators adjust Δt automatically for accuracy." />
        </div>
        <div className={s.sectionBody}>
          <div className={s.row}>
            <span className={s.rowLabel}>Integrator</span>
            <div className={s.rowControl}>
              <select
                className={s.compactSelect}
                value={settings.integrator}
                onChange={(e) => update({ integrator: e.target.value })}
                disabled={disabled}
              >
                {INTEGRATOR_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {selectedIntegrator && (
            <div className={s.optionDesc}>{selectedIntegrator.desc}</div>
          )}

          <div className={s.row}>
            <span className={s.rowLabel}>
              Fixed Δt
              <HelpTip text="Leave empty for adaptive timestep (recommended for RK2(3)/RK4(5)). Set to e.g. 1e-13 for fixed-step integrators." />
            </span>
            <div className={s.rowControl}>
              <input
                className={s.compactInput}
                type="text"
                value={settings.fixedTimestep}
                onChange={(e) => update({ fixedTimestep: e.target.value })}
                placeholder="auto"
                disabled={disabled}
              />
            </div>
          </div>
        </div>
      </div>

      {/* ── Relaxation ── */}
      <div className={s.section}>
        <div className={s.sectionHeader}>
          <span className={s.sectionTitle}>Relaxation</span>
          <HelpTip text="Energy minimization to find the ground state. The solver iterates until torque drops below the tolerance or the max step count is reached." />
        </div>
        <div className={s.sectionBody}>
          <div className={s.row}>
            <span className={s.rowLabel}>Algorithm</span>
            <div className={s.rowControl}>
              <select
                className={s.compactSelect}
                value={settings.relaxAlgorithm}
                onChange={(e) => update({ relaxAlgorithm: e.target.value })}
                disabled={disabled}
              >
                {RELAX_ALGORITHM_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {selectedRelax && (
            <div className={s.optionDesc}>{selectedRelax.desc}</div>
          )}

          <div className={s.row}>
            <span className={s.rowLabel}>
              Torque tol.
              <HelpTip text="Convergence criterion: max|m × H_eff| < tolerance. Typical: 1e-5 (fast) to 1e-7 (precise). Unit: T." />
            </span>
            <div className={s.rowControl}>
              <input
                className={s.compactInput}
                type="text"
                value={settings.torqueTolerance}
                onChange={(e) => update({ torqueTolerance: e.target.value })}
                placeholder="1e-6"
                disabled={disabled}
              />
            </div>
          </div>

          <div className={s.row}>
            <span className={s.rowLabel}>
              Energy tol.
              <HelpTip text="Optional secondary criterion: |ΔE_total| < tolerance between steps. Leave empty to use torque-only convergence." />
            </span>
            <div className={s.rowControl}>
              <input
                className={s.compactInput}
                type="text"
                value={settings.energyTolerance}
                onChange={(e) => update({ energyTolerance: e.target.value })}
                placeholder="disabled"
                disabled={disabled}
              />
            </div>
          </div>

          <div className={s.row}>
            <span className={s.rowLabel}>
              Max steps
              <HelpTip text="Maximum number of iterations before giving up. Increase for complex geometries or tight tolerances." />
            </span>
            <div className={s.rowControl}>
              <input
                className={s.compactInput}
                type="text"
                value={settings.maxRelaxSteps}
                onChange={(e) => update({ maxRelaxSteps: e.target.value })}
                placeholder="5000"
                disabled={disabled}
              />
            </div>
          </div>

          <div className={s.row}>
            <span className={s.rowLabel}>
              Damping α
              <HelpTip text="Override the material damping for relaxation. Leave empty to use the material value. Higher α (e.g. 0.5–1.0) speeds convergence." />
            </span>
            <div className={s.rowControl}>
              <input
                className={s.compactInput}
                type="text"
                value={settings.relaxAlpha}
                onChange={(e) => update({ relaxAlpha: e.target.value })}
                placeholder="material default"
                disabled={disabled}
              />
            </div>
          </div>
        </div>
      </div>

      {/* ── Apply button ── */}
      {canApply && onApply && (
        <button
          className={s.applyBtn}
          onClick={onApply}
          type="button"
        >
          Apply settings to next command
        </button>
      )}

      {solverRunning && (
        <div className={s.runningNote}>
          Solver is running. Stop the simulation to modify settings.
        </div>
      )}
    </div>
  );
}
