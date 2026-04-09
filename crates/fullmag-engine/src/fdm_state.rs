//! Simulation state, integrator buffers, and solver session types.

use crate::vector::normalized;
use crate::{EngineError, ExchangeLlgProblem, FftWorkspace, GridShape, Result, Vector3};

// ── ExchangeLlgState ───────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq)]
pub struct ExchangeLlgState {
    pub(crate) grid: GridShape,
    pub(crate) magnetization: Vec<Vector3>,
    pub time_seconds: f64,
    /// FSAL (First Same As Last) buffer for Dormand–Prince 5(4).
    pub(crate) k_fsal: Option<Vec<Vector3>>,
    /// ABM(3) history: stores the last 3 RHS evaluations for multi-step prediction.
    pub(crate) abm_history: AbmHistory,
}

impl ExchangeLlgState {
    pub fn new(grid: GridShape, magnetization: Vec<Vector3>) -> Result<Self> {
        if magnetization.len() != grid.cell_count() {
            return Err(EngineError::new(format!(
                "magnetization length {} does not match grid cell count {}",
                magnetization.len(),
                grid.cell_count()
            )));
        }

        let magnetization = magnetization
            .into_iter()
            .map(normalized)
            .collect::<Result<Vec<_>>>()?;

        Ok(Self {
            grid,
            magnetization,
            time_seconds: 0.0,
            k_fsal: None,
            abm_history: AbmHistory::new(),
        })
    }

    pub fn uniform(grid: GridShape, value: Vector3) -> Result<Self> {
        Self::new(grid, vec![value; grid.cell_count()])
    }

    pub fn magnetization(&self) -> &[Vector3] {
        &self.magnetization
    }

    /// Invalidate the FSAL buffer (e.g. after external state modification).
    pub fn invalidate_fsal(&mut self) {
        self.k_fsal = None;
    }

    /// Check whether a valid FSAL RHS is available.
    pub fn has_fsal(&self) -> bool {
        self.k_fsal.is_some()
    }

    /// Reset ABM multi-step history (e.g. after external state modification).
    pub fn reset_abm_history(&mut self) {
        self.abm_history.restart();
    }

    /// Replace the magnetization vector, normalizing each cell.
    ///
    /// Zero vectors (inactive cells) are preserved as-is.
    pub fn set_magnetization(&mut self, magnetization: Vec<Vector3>) -> Result<()> {
        if magnetization.len() != self.grid.cell_count() {
            return Err(EngineError::new(format!(
                "magnetization length {} does not match grid cell count {}",
                magnetization.len(),
                self.grid.cell_count()
            )));
        }
        self.magnetization = magnetization
            .into_iter()
            .map(normalized)
            .collect::<Result<Vec<_>>>()?;
        Ok(())
    }
}

// ── AbmHistory ─────────────────────────────────────────────────────────

/// History buffer for Adams–Bashforth–Moulton 3rd-order predictor-corrector.
#[derive(Debug, Clone, PartialEq)]
pub struct AbmHistory {
    /// RHS at step n (most recent)
    pub(crate) f_n: Option<Vec<Vector3>>,
    /// RHS at step n-1
    pub(crate) f_n_minus_1: Option<Vec<Vector3>>,
    /// RHS at step n-2
    pub(crate) f_n_minus_2: Option<Vec<Vector3>>,
    /// Number of startup steps completed (0..3)
    pub(crate) startup_steps: u32,
    /// Last dt used (ABM requires constant dt; restart if changed)
    pub(crate) last_dt: f64,
}

impl AbmHistory {
    pub(crate) fn new() -> Self {
        Self {
            f_n: None,
            f_n_minus_1: None,
            f_n_minus_2: None,
            startup_steps: 0,
            last_dt: 0.0,
        }
    }

    pub(crate) fn is_ready(&self) -> bool {
        self.startup_steps >= 3
            && self.f_n.is_some()
            && self.f_n_minus_1.is_some()
            && self.f_n_minus_2.is_some()
    }

    pub(crate) fn f_n(&self) -> Option<&[Vector3]> {
        self.f_n.as_deref()
    }

    pub(crate) fn f_n_minus_1(&self) -> Option<&[Vector3]> {
        self.f_n_minus_1.as_deref()
    }

    pub(crate) fn f_n_minus_2(&self) -> Option<&[Vector3]> {
        self.f_n_minus_2.as_deref()
    }

    /// Push a new RHS evaluation, rotating the history buffer.
    pub(crate) fn push(&mut self, f: Vec<Vector3>, dt: f64) {
        // Check if dt has changed significantly — if so, restart.
        if self.last_dt > 0.0 && (dt - self.last_dt).abs() / self.last_dt > 0.1 {
            self.restart();
        }
        self.f_n_minus_2 = self.f_n_minus_1.take();
        self.f_n_minus_1 = self.f_n.take();
        self.f_n = Some(f);
        self.startup_steps = (self.startup_steps + 1).min(3);
        self.last_dt = dt;
    }

    pub(crate) fn restart(&mut self) {
        *self = Self::new();
    }
}

// ── StepReport ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct StepReport {
    pub time_seconds: f64,
    pub dt_used: f64,
    pub step_rejected: bool,
    pub suggested_next_dt: Option<f64>,
    pub exchange_energy_joules: f64,
    pub demag_energy_joules: f64,
    pub external_energy_joules: f64,
    pub total_energy_joules: f64,
    pub max_effective_field_amplitude: f64,
    pub max_demag_field_amplitude: f64,
    pub max_rhs_amplitude: f64,
}

// ── EffectiveFieldObservables ──────────────────────────────────────────

#[derive(Debug, Clone, PartialEq)]
pub struct EffectiveFieldObservables {
    pub magnetization: Vec<Vector3>,
    pub exchange_field: Vec<Vector3>,
    pub demag_field: Vec<Vector3>,
    pub external_field: Vec<Vector3>,
    pub effective_field: Vec<Vector3>,
    pub exchange_energy_joules: f64,
    pub demag_energy_joules: f64,
    pub external_energy_joules: f64,
    pub total_energy_joules: f64,
    pub max_effective_field_amplitude: f64,
    pub max_demag_field_amplitude: f64,
    pub max_rhs_amplitude: f64,
}

// ── RhsEvaluation ─────────────────────────────────────────────────────

/// Lightweight observables from a single RHS evaluation.
#[derive(Debug, Clone, PartialEq)]
pub struct RhsEvaluation {
    pub exchange_energy_joules: f64,
    pub demag_energy_joules: f64,
    pub external_energy_joules: f64,
    pub total_energy_joules: f64,
    pub max_effective_field_amplitude: f64,
    pub max_demag_field_amplitude: f64,
    pub max_rhs_amplitude: f64,
}

impl RhsEvaluation {
    /// Convert to a `StepReport`.
    pub fn into_step_report(
        self,
        time_seconds: f64,
        dt_used: f64,
        step_rejected: bool,
    ) -> StepReport {
        StepReport {
            time_seconds,
            dt_used,
            step_rejected,
            suggested_next_dt: None,
            exchange_energy_joules: self.exchange_energy_joules,
            demag_energy_joules: self.demag_energy_joules,
            external_energy_joules: self.external_energy_joules,
            total_energy_joules: self.total_energy_joules,
            max_effective_field_amplitude: self.max_effective_field_amplitude,
            max_demag_field_amplitude: self.max_demag_field_amplitude,
            max_rhs_amplitude: self.max_rhs_amplitude,
        }
    }
}

// ── IntegratorBuffers ──────────────────────────────────────────────────

/// Preallocated workspace buffers for time integrator stages.
#[derive(Debug, Clone)]
pub struct IntegratorBuffers {
    /// k-stage buffers (k1..k7).  RK45 needs 7, others need fewer.
    pub k: [Vec<Vector3>; 7],
    /// Intermediate delta workspace (weighted sum of k-stages × dt).
    pub delta: Vec<Vector3>,
    /// Intermediate magnetization state for sub-stages.
    pub m_stage: Vec<Vector3>,
    /// Backup of initial magnetization at start of step.
    pub m0: Vec<Vector3>,
    /// Effective field workspace — reused across RHS evaluations.
    pub h_eff: Vec<Vector3>,
    /// Scratch buffer for individual field terms during zero-alloc report.
    pub h_scratch: Vec<Vector3>,
    /// RHS output buffer for zero-alloc report computation.
    pub rhs: Vec<Vector3>,
}

impl IntegratorBuffers {
    /// Allocate zeroed buffers for `n` cells.
    pub fn new(n: usize) -> Self {
        let zero = || vec![[0.0, 0.0, 0.0]; n];
        Self {
            k: [zero(), zero(), zero(), zero(), zero(), zero(), zero()],
            delta: zero(),
            m_stage: zero(),
            m0: zero(),
            h_eff: zero(),
            h_scratch: zero(),
            rhs: zero(),
        }
    }
}

// ── SolverSession ──────────────────────────────────────────────────────

/// Persistent solver session bundling all per-simulation resources.
pub struct SolverSession {
    problem: ExchangeLlgProblem,
    state: ExchangeLlgState,
    fft_ws: FftWorkspace,
    bufs: IntegratorBuffers,
    step_count: u64,
}

impl SolverSession {
    /// Create a new solver session with the given problem and initial magnetization.
    pub fn new(problem: ExchangeLlgProblem, magnetization: Vec<Vector3>) -> Result<Self> {
        let state = ExchangeLlgState::new(problem.grid, magnetization)?;
        let fft_ws = problem.create_workspace();
        let bufs = problem.create_integrator_buffers();
        Ok(Self {
            problem,
            state,
            fft_ws,
            bufs,
            step_count: 0,
        })
    }

    /// Advance the simulation by one time step.
    pub fn step(&mut self, dt: f64) -> Result<StepReport> {
        let report = self.problem.step_with_buffers(
            &mut self.state,
            dt,
            &mut self.fft_ws,
            &mut self.bufs,
        )?;
        self.step_count += 1;
        Ok(report)
    }

    /// Current magnetization.
    pub fn magnetization(&self) -> &[Vector3] {
        self.state.magnetization()
    }

    /// Current simulation time (seconds).
    pub fn time(&self) -> f64 {
        self.state.time_seconds
    }

    /// Number of steps taken so far.
    pub fn step_count(&self) -> u64 {
        self.step_count
    }

    /// Mutable access to the state.
    pub fn state_mut(&mut self) -> &mut ExchangeLlgState {
        &mut self.state
    }

    /// Immutable access to the state.
    pub fn state(&self) -> &ExchangeLlgState {
        &self.state
    }

    /// Immutable access to the problem.
    pub fn problem(&self) -> &ExchangeLlgProblem {
        &self.problem
    }

    /// Compute full observables at the current state.
    pub fn observe(&mut self) -> EffectiveFieldObservables {
        self.problem
            .observe_vectors_ws(self.state.magnetization(), &mut self.fft_ws)
    }
}
