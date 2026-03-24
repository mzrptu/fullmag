use rustfft::num_complex::Complex;
use rustfft::FftPlanner;
use std::error::Error;
use std::f64::consts::PI;
use std::fmt;

pub const MU0: f64 = 4.0 * PI * 1e-7;
pub const DEFAULT_GYROMAGNETIC_RATIO: f64 = 2.211e5;

pub type Vector3 = [f64; 3];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EngineError {
    message: String,
}

impl EngineError {
    fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

impl fmt::Display for EngineError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl Error for EngineError {}

type Result<T> = std::result::Result<T, EngineError>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct GridShape {
    pub nx: usize,
    pub ny: usize,
    pub nz: usize,
}

impl GridShape {
    pub fn new(nx: usize, ny: usize, nz: usize) -> Result<Self> {
        if nx == 0 || ny == 0 || nz == 0 {
            return Err(EngineError::new("grid shape components must be >= 1"));
        }
        Ok(Self { nx, ny, nz })
    }

    pub fn cell_count(self) -> usize {
        self.nx * self.ny * self.nz
    }

    fn index(self, x: usize, y: usize, z: usize) -> usize {
        x + self.nx * (y + self.ny * z)
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CellSize {
    pub dx: f64,
    pub dy: f64,
    pub dz: f64,
}

impl CellSize {
    pub fn new(dx: f64, dy: f64, dz: f64) -> Result<Self> {
        for (name, value) in [("dx", dx), ("dy", dy), ("dz", dz)] {
            if value <= 0.0 {
                return Err(EngineError::new(format!("{name} must be positive")));
            }
        }
        Ok(Self { dx, dy, dz })
    }

    pub fn volume(self) -> f64 {
        self.dx * self.dy * self.dz
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct MaterialParameters {
    pub saturation_magnetisation: f64,
    pub exchange_stiffness: f64,
    pub damping: f64,
}

impl MaterialParameters {
    pub fn new(
        saturation_magnetisation: f64,
        exchange_stiffness: f64,
        damping: f64,
    ) -> Result<Self> {
        if saturation_magnetisation <= 0.0 {
            return Err(EngineError::new(
                "saturation_magnetisation must be positive",
            ));
        }
        if exchange_stiffness <= 0.0 {
            return Err(EngineError::new("exchange_stiffness must be positive"));
        }
        if damping < 0.0 {
            return Err(EngineError::new("damping must be >= 0"));
        }
        Ok(Self {
            saturation_magnetisation,
            exchange_stiffness,
            damping,
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TimeIntegrator {
    Heun,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct LlgConfig {
    pub gyromagnetic_ratio: f64,
    pub integrator: TimeIntegrator,
}

impl Default for LlgConfig {
    fn default() -> Self {
        Self {
            gyromagnetic_ratio: DEFAULT_GYROMAGNETIC_RATIO,
            integrator: TimeIntegrator::Heun,
        }
    }
}

impl LlgConfig {
    pub fn new(gyromagnetic_ratio: f64, integrator: TimeIntegrator) -> Result<Self> {
        if gyromagnetic_ratio <= 0.0 {
            return Err(EngineError::new("gyromagnetic_ratio must be positive"));
        }
        Ok(Self {
            gyromagnetic_ratio,
            integrator,
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct EffectiveFieldTerms {
    pub exchange: bool,
    pub demag: bool,
    pub external_field: Option<Vector3>,
}

impl Default for EffectiveFieldTerms {
    fn default() -> Self {
        Self {
            exchange: true,
            demag: false,
            external_field: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ExchangeLlgState {
    grid: GridShape,
    magnetization: Vec<Vector3>,
    pub time_seconds: f64,
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
        })
    }

    pub fn uniform(grid: GridShape, value: Vector3) -> Result<Self> {
        Self::new(grid, vec![value; grid.cell_count()])
    }

    pub fn magnetization(&self) -> &[Vector3] {
        &self.magnetization
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct StepReport {
    pub time_seconds: f64,
    pub exchange_energy_joules: f64,
    pub demag_energy_joules: f64,
    pub external_energy_joules: f64,
    pub total_energy_joules: f64,
    pub max_effective_field_amplitude: f64,
    pub max_rhs_amplitude: f64,
}

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
    pub max_rhs_amplitude: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ExchangeLlgProblem {
    pub grid: GridShape,
    pub cell_size: CellSize,
    pub material: MaterialParameters,
    pub dynamics: LlgConfig,
    pub terms: EffectiveFieldTerms,
}

impl ExchangeLlgProblem {
    pub fn new(
        grid: GridShape,
        cell_size: CellSize,
        material: MaterialParameters,
        dynamics: LlgConfig,
    ) -> Self {
        Self::with_terms(grid, cell_size, material, dynamics, EffectiveFieldTerms::default())
    }

    pub fn with_terms(
        grid: GridShape,
        cell_size: CellSize,
        material: MaterialParameters,
        dynamics: LlgConfig,
        terms: EffectiveFieldTerms,
    ) -> Self {
        Self {
            grid,
            cell_size,
            material,
            dynamics,
            terms,
        }
    }

    pub fn new_state(&self, magnetization: Vec<Vector3>) -> Result<ExchangeLlgState> {
        ExchangeLlgState::new(self.grid, magnetization)
    }

    pub fn uniform_state(&self, value: Vector3) -> Result<ExchangeLlgState> {
        ExchangeLlgState::uniform(self.grid, value)
    }

    pub fn exchange_field(&self, state: &ExchangeLlgState) -> Result<Vec<Vector3>> {
        self.ensure_state_matches_grid(state)?;
        Ok(if self.terms.exchange {
            self.exchange_field_from_vectors(state.magnetization())
        } else {
            zero_vectors(self.grid.cell_count())
        })
    }

    pub fn demag_field(&self, state: &ExchangeLlgState) -> Result<Vec<Vector3>> {
        self.ensure_state_matches_grid(state)?;
        Ok(if self.terms.demag {
            self.demag_field_from_vectors(state.magnetization())
        } else {
            zero_vectors(self.grid.cell_count())
        })
    }

    pub fn external_field(&self, state: &ExchangeLlgState) -> Result<Vec<Vector3>> {
        self.ensure_state_matches_grid(state)?;
        Ok(self.external_field_vectors())
    }

    pub fn effective_field(&self, state: &ExchangeLlgState) -> Result<Vec<Vector3>> {
        self.ensure_state_matches_grid(state)?;
        Ok(self.effective_field_from_vectors(state.magnetization()))
    }

    pub fn llg_rhs(&self, state: &ExchangeLlgState) -> Result<Vec<Vector3>> {
        self.ensure_state_matches_grid(state)?;
        Ok(self.llg_rhs_from_vectors(state.magnetization()))
    }

    pub fn exchange_energy(&self, state: &ExchangeLlgState) -> Result<f64> {
        self.ensure_state_matches_grid(state)?;
        Ok(if self.terms.exchange {
            self.exchange_energy_from_vectors(state.magnetization())
        } else {
            0.0
        })
    }

    pub fn observe(&self, state: &ExchangeLlgState) -> Result<EffectiveFieldObservables> {
        self.ensure_state_matches_grid(state)?;
        Ok(self.observe_vectors(state.magnetization()))
    }

    pub fn step(&self, state: &mut ExchangeLlgState, dt: f64) -> Result<StepReport> {
        self.ensure_state_matches_grid(state)?;
        if dt <= 0.0 {
            return Err(EngineError::new("dt must be positive"));
        }

        match self.dynamics.integrator {
            TimeIntegrator::Heun => self.heun_step(state, dt),
        }
    }

    fn heun_step(&self, state: &mut ExchangeLlgState, dt: f64) -> Result<StepReport> {
        let initial = state.magnetization.clone();
        let k1 = self.llg_rhs_from_vectors(&initial);

        let predicted = initial
            .iter()
            .zip(k1.iter())
            .map(|(m, rhs)| normalized(add(*m, scale(*rhs, dt))))
            .collect::<Result<Vec<_>>>()?;

        let k2 = self.llg_rhs_from_vectors(&predicted);
        let corrected = initial
            .iter()
            .zip(k1.iter().zip(k2.iter()))
            .map(|(m, (rhs1, rhs2))| normalized(add(*m, scale(add(*rhs1, *rhs2), 0.5 * dt))))
            .collect::<Result<Vec<_>>>()?;

        state.magnetization = corrected;
        state.time_seconds += dt;

        let observables = self.observe_vectors(state.magnetization());

        Ok(StepReport {
            time_seconds: state.time_seconds,
            exchange_energy_joules: observables.exchange_energy_joules,
            demag_energy_joules: observables.demag_energy_joules,
            external_energy_joules: observables.external_energy_joules,
            total_energy_joules: observables.total_energy_joules,
            max_effective_field_amplitude: observables.max_effective_field_amplitude,
            max_rhs_amplitude: observables.max_rhs_amplitude,
        })
    }

    fn ensure_state_matches_grid(&self, state: &ExchangeLlgState) -> Result<()> {
        if state.grid != self.grid {
            return Err(EngineError::new(
                "state grid does not match the problem grid shape",
            ));
        }
        Ok(())
    }

    fn observe_vectors(&self, magnetization: &[Vector3]) -> EffectiveFieldObservables {
        let exchange_field = if self.terms.exchange {
            self.exchange_field_from_vectors(magnetization)
        } else {
            zero_vectors(self.grid.cell_count())
        };
        let demag_field = if self.terms.demag {
            self.demag_field_from_vectors(magnetization)
        } else {
            zero_vectors(self.grid.cell_count())
        };
        let external_field = self.external_field_vectors();
        let effective_field = combine_fields(&exchange_field, &demag_field, &external_field);
        let rhs = magnetization
            .iter()
            .zip(effective_field.iter())
            .map(|(m, h)| self.llg_rhs_from_field(*m, *h))
            .collect::<Vec<_>>();

        let exchange_energy_joules = if self.terms.exchange {
            self.exchange_energy_from_vectors(magnetization)
        } else {
            0.0
        };
        let demag_energy_joules = if self.terms.demag {
            self.demag_energy_from_fields(magnetization, &demag_field)
        } else {
            0.0
        };
        let external_energy_joules = if self.terms.external_field.is_some() {
            self.external_energy_from_fields(magnetization, &external_field)
        } else {
            0.0
        };
        let total_energy_joules =
            exchange_energy_joules + demag_energy_joules + external_energy_joules;

        EffectiveFieldObservables {
            magnetization: magnetization.to_vec(),
            exchange_field,
            demag_field,
            external_field,
            effective_field: effective_field.clone(),
            exchange_energy_joules,
            demag_energy_joules,
            external_energy_joules,
            total_energy_joules,
            max_effective_field_amplitude: max_norm(&effective_field),
            max_rhs_amplitude: max_norm(&rhs),
        }
    }

    fn exchange_field_from_vectors(&self, magnetization: &[Vector3]) -> Vec<Vector3> {
        let prefactor =
            2.0 * self.material.exchange_stiffness / (MU0 * self.material.saturation_magnetisation);
        let dx2 = self.cell_size.dx * self.cell_size.dx;
        let dy2 = self.cell_size.dy * self.cell_size.dy;
        let dz2 = self.cell_size.dz * self.cell_size.dz;

        let mut field = vec![[0.0, 0.0, 0.0]; self.grid.cell_count()];
        for z in 0..self.grid.nz {
            for y in 0..self.grid.ny {
                for x in 0..self.grid.nx {
                    let center_index = self.grid.index(x, y, z);
                    let center = magnetization[center_index];
                    let x_minus = magnetization[self.grid.index(x.saturating_sub(1), y, z)];
                    let x_plus =
                        magnetization[self.grid.index((x + 1).min(self.grid.nx - 1), y, z)];
                    let y_minus = magnetization[self.grid.index(x, y.saturating_sub(1), z)];
                    let y_plus =
                        magnetization[self.grid.index(x, (y + 1).min(self.grid.ny - 1), z)];
                    let z_minus = magnetization[self.grid.index(x, y, z.saturating_sub(1))];
                    let z_plus =
                        magnetization[self.grid.index(x, y, (z + 1).min(self.grid.nz - 1))];

                    let mut laplacian = [0.0, 0.0, 0.0];
                    for component in 0..3 {
                        laplacian[component] = (x_plus[component] - 2.0 * center[component]
                            + x_minus[component])
                            / dx2
                            + (y_plus[component] - 2.0 * center[component] + y_minus[component])
                                / dy2
                            + (z_plus[component] - 2.0 * center[component] + z_minus[component])
                                / dz2;
                    }

                    field[center_index] = scale(laplacian, prefactor);
                }
            }
        }
        field
    }

    fn demag_field_from_vectors(&self, magnetization: &[Vector3]) -> Vec<Vector3> {
        let px = self.grid.nx * 2;
        let py = self.grid.ny * 2;
        let pz = self.grid.nz * 2;
        let padded_len = px * py * pz;

        let mut mx = vec![Complex::new(0.0, 0.0); padded_len];
        let mut my = vec![Complex::new(0.0, 0.0); padded_len];
        let mut mz = vec![Complex::new(0.0, 0.0); padded_len];

        for z in 0..self.grid.nz {
            for y in 0..self.grid.ny {
                for x in 0..self.grid.nx {
                    let src_index = self.grid.index(x, y, z);
                    let dst_index = padded_index(px, py, x, y, z);
                    let moment = scale(
                        magnetization[src_index],
                        self.material.saturation_magnetisation,
                    );
                    mx[dst_index] = Complex::new(moment[0], 0.0);
                    my[dst_index] = Complex::new(moment[1], 0.0);
                    mz[dst_index] = Complex::new(moment[2], 0.0);
                }
            }
        }

        fft3_in_place(&mut mx, px, py, pz, false);
        fft3_in_place(&mut my, px, py, pz, false);
        fft3_in_place(&mut mz, px, py, pz, false);

        let lx = px as f64 * self.cell_size.dx;
        let ly = py as f64 * self.cell_size.dy;
        let lz = pz as f64 * self.cell_size.dz;

        let mut hx = vec![Complex::new(0.0, 0.0); padded_len];
        let mut hy = vec![Complex::new(0.0, 0.0); padded_len];
        let mut hz = vec![Complex::new(0.0, 0.0); padded_len];

        for z in 0..pz {
            let kz = 2.0 * PI * frequency_index(z, pz) as f64 / lz;
            for y in 0..py {
                let ky = 2.0 * PI * frequency_index(y, py) as f64 / ly;
                for x in 0..px {
                    let kx = 2.0 * PI * frequency_index(x, px) as f64 / lx;
                    let k2 = kx * kx + ky * ky + kz * kz;
                    if k2 == 0.0 {
                        continue;
                    }

                    let index = padded_index(px, py, x, y, z);
                    let kdotm = mx[index] * kx + my[index] * ky + mz[index] * kz;
                    hx[index] = -kdotm * (kx / k2);
                    hy[index] = -kdotm * (ky / k2);
                    hz[index] = -kdotm * (kz / k2);
                }
            }
        }

        fft3_in_place(&mut hx, px, py, pz, true);
        fft3_in_place(&mut hy, px, py, pz, true);
        fft3_in_place(&mut hz, px, py, pz, true);

        let normalisation = 1.0 / padded_len as f64;
        let mut field = vec![[0.0, 0.0, 0.0]; self.grid.cell_count()];
        for z in 0..self.grid.nz {
            for y in 0..self.grid.ny {
                for x in 0..self.grid.nx {
                    let src_index = padded_index(px, py, x, y, z);
                    let dst_index = self.grid.index(x, y, z);
                    field[dst_index] = [
                        hx[src_index].re * normalisation,
                        hy[src_index].re * normalisation,
                        hz[src_index].re * normalisation,
                    ];
                }
            }
        }

        field
    }

    fn external_field_vectors(&self) -> Vec<Vector3> {
        vec![self.terms.external_field.unwrap_or([0.0, 0.0, 0.0]); self.grid.cell_count()]
    }

    fn effective_field_from_vectors(&self, magnetization: &[Vector3]) -> Vec<Vector3> {
        let exchange_field = if self.terms.exchange {
            self.exchange_field_from_vectors(magnetization)
        } else {
            zero_vectors(self.grid.cell_count())
        };
        let demag_field = if self.terms.demag {
            self.demag_field_from_vectors(magnetization)
        } else {
            zero_vectors(self.grid.cell_count())
        };
        let external_field = self.external_field_vectors();
        combine_fields(&exchange_field, &demag_field, &external_field)
    }

    fn llg_rhs_from_vectors(&self, magnetization: &[Vector3]) -> Vec<Vector3> {
        let field = self.effective_field_from_vectors(magnetization);
        magnetization
            .iter()
            .zip(field.iter())
            .map(|(m, h)| self.llg_rhs_from_field(*m, *h))
            .collect()
    }

    fn llg_rhs_from_field(&self, magnetization: Vector3, field: Vector3) -> Vector3 {
        let alpha = self.material.damping;
        let gamma_bar = self.dynamics.gyromagnetic_ratio / (1.0 + alpha * alpha);
        let precession = cross(magnetization, field);
        let damping = cross(magnetization, precession);
        scale(add(precession, scale(damping, alpha)), -gamma_bar)
    }

    pub fn exchange_energy_from_vectors(&self, magnetization: &[Vector3]) -> f64 {
        let cell_volume = self.cell_size.volume();
        let mut energy = 0.0;

        for z in 0..self.grid.nz {
            for y in 0..self.grid.ny {
                for x in 0..self.grid.nx {
                    let index = self.grid.index(x, y, z);
                    let center = magnetization[index];

                    if x + 1 < self.grid.nx {
                        let neighbor = magnetization[self.grid.index(x + 1, y, z)];
                        energy += self.material.exchange_stiffness
                            * cell_volume
                            * squared_norm(sub(neighbor, center))
                            / (self.cell_size.dx * self.cell_size.dx);
                    }
                    if y + 1 < self.grid.ny {
                        let neighbor = magnetization[self.grid.index(x, y + 1, z)];
                        energy += self.material.exchange_stiffness
                            * cell_volume
                            * squared_norm(sub(neighbor, center))
                            / (self.cell_size.dy * self.cell_size.dy);
                    }
                    if z + 1 < self.grid.nz {
                        let neighbor = magnetization[self.grid.index(x, y, z + 1)];
                        energy += self.material.exchange_stiffness
                            * cell_volume
                            * squared_norm(sub(neighbor, center))
                            / (self.cell_size.dz * self.cell_size.dz);
                    }
                }
            }
        }

        energy
    }

    fn demag_energy_from_fields(&self, magnetization: &[Vector3], demag_field: &[Vector3]) -> f64 {
        let cell_volume = self.cell_size.volume();
        magnetization
            .iter()
            .zip(demag_field.iter())
            .map(|(m, h)| {
                -0.5
                    * MU0
                    * self.material.saturation_magnetisation
                    * dot(*m, *h)
                    * cell_volume
            })
            .sum()
    }

    fn external_energy_from_fields(
        &self,
        magnetization: &[Vector3],
        external_field: &[Vector3],
    ) -> f64 {
        let cell_volume = self.cell_size.volume();
        magnetization
            .iter()
            .zip(external_field.iter())
            .map(|(m, h)| {
                -MU0
                    * self.material.saturation_magnetisation
                    * dot(*m, *h)
                    * cell_volume
            })
            .sum()
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ReferenceDemoReport {
    pub steps: usize,
    pub dt: f64,
    pub initial_exchange_energy_joules: f64,
    pub final_exchange_energy_joules: f64,
    pub final_time_seconds: f64,
    pub final_center_magnetization: Vector3,
    pub max_effective_field_amplitude: f64,
    pub max_rhs_amplitude: f64,
}

pub fn run_reference_exchange_demo(steps: usize, dt: f64) -> Result<ReferenceDemoReport> {
    if dt <= 0.0 {
        return Err(EngineError::new("dt must be positive"));
    }
    let grid = GridShape::new(3, 1, 1)?;
    let problem = ExchangeLlgProblem::new(
        grid,
        CellSize::new(2e-9, 2e-9, 2e-9)?,
        MaterialParameters::new(800e3, 13e-12, 0.2)?,
        LlgConfig::default(),
    );
    let mut state = problem.new_state(vec![[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [1.0, 0.0, 0.0]])?;
    let initial_exchange_energy_joules = problem.exchange_energy(&state)?;
    let mut last_report = StepReport {
        time_seconds: 0.0,
        exchange_energy_joules: initial_exchange_energy_joules,
        demag_energy_joules: 0.0,
        external_energy_joules: 0.0,
        total_energy_joules: initial_exchange_energy_joules,
        max_effective_field_amplitude: 0.0,
        max_rhs_amplitude: 0.0,
    };

    for _ in 0..steps {
        last_report = problem.step(&mut state, dt)?;
    }

    Ok(ReferenceDemoReport {
        steps,
        dt,
        initial_exchange_energy_joules,
        final_exchange_energy_joules: last_report.exchange_energy_joules,
        final_time_seconds: last_report.time_seconds,
        final_center_magnetization: state.magnetization()[grid.index(1, 0, 0)],
        max_effective_field_amplitude: last_report.max_effective_field_amplitude,
        max_rhs_amplitude: last_report.max_rhs_amplitude,
    })
}

fn fft3_in_place(
    data: &mut [Complex<f64>],
    nx: usize,
    ny: usize,
    nz: usize,
    inverse: bool,
) {
    let mut planner = FftPlanner::<f64>::new();
    let fft_x = if inverse {
        planner.plan_fft_inverse(nx)
    } else {
        planner.plan_fft_forward(nx)
    };
    let fft_y = if inverse {
        planner.plan_fft_inverse(ny)
    } else {
        planner.plan_fft_forward(ny)
    };
    let fft_z = if inverse {
        planner.plan_fft_inverse(nz)
    } else {
        planner.plan_fft_forward(nz)
    };

    for z in 0..nz {
        for y in 0..ny {
            let start = padded_index(nx, ny, 0, y, z);
            fft_x.process(&mut data[start..start + nx]);
        }
    }

    let mut line_y = vec![Complex::new(0.0, 0.0); ny];
    for z in 0..nz {
        for x in 0..nx {
            for y in 0..ny {
                line_y[y] = data[padded_index(nx, ny, x, y, z)];
            }
            fft_y.process(&mut line_y);
            for y in 0..ny {
                data[padded_index(nx, ny, x, y, z)] = line_y[y];
            }
        }
    }

    let mut line_z = vec![Complex::new(0.0, 0.0); nz];
    for y in 0..ny {
        for x in 0..nx {
            for z in 0..nz {
                line_z[z] = data[padded_index(nx, ny, x, y, z)];
            }
            fft_z.process(&mut line_z);
            for z in 0..nz {
                data[padded_index(nx, ny, x, y, z)] = line_z[z];
            }
        }
    }
}

fn padded_index(nx: usize, ny: usize, x: usize, y: usize, z: usize) -> usize {
    x + nx * (y + ny * z)
}

fn frequency_index(index: usize, n: usize) -> isize {
    if index <= n / 2 {
        index as isize
    } else {
        index as isize - n as isize
    }
}

fn zero_vectors(len: usize) -> Vec<Vector3> {
    vec![[0.0, 0.0, 0.0]; len]
}

fn combine_fields(
    exchange_field: &[Vector3],
    demag_field: &[Vector3],
    external_field: &[Vector3],
) -> Vec<Vector3> {
    exchange_field
        .iter()
        .zip(demag_field.iter().zip(external_field.iter()))
        .map(|(h_ex, (h_demag, h_ext))| add(add(*h_ex, *h_demag), *h_ext))
        .collect()
}

fn normalized(vector: Vector3) -> Result<Vector3> {
    let norm = norm(vector);
    if norm <= 0.0 {
        return Err(EngineError::new(
            "magnetization vectors must have non-zero norm",
        ));
    }
    Ok(scale(vector, 1.0 / norm))
}

fn max_norm(vectors: &[Vector3]) -> f64 {
    vectors
        .iter()
        .map(|vector| norm(*vector))
        .fold(0.0, f64::max)
}

fn add(left: Vector3, right: Vector3) -> Vector3 {
    [left[0] + right[0], left[1] + right[1], left[2] + right[2]]
}

fn sub(left: Vector3, right: Vector3) -> Vector3 {
    [left[0] - right[0], left[1] - right[1], left[2] - right[2]]
}

fn scale(vector: Vector3, factor: f64) -> Vector3 {
    [vector[0] * factor, vector[1] * factor, vector[2] * factor]
}

fn dot(left: Vector3, right: Vector3) -> f64 {
    left[0] * right[0] + left[1] * right[1] + left[2] * right[2]
}

fn cross(left: Vector3, right: Vector3) -> Vector3 {
    [
        left[1] * right[2] - left[2] * right[1],
        left[2] * right[0] - left[0] * right[2],
        left[0] * right[1] - left[1] * right[0],
    ]
}

fn squared_norm(vector: Vector3) -> f64 {
    dot(vector, vector)
}

fn norm(vector: Vector3) -> f64 {
    squared_norm(vector).sqrt()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn simple_problem(alpha: f64, gamma: f64) -> ExchangeLlgProblem {
        let grid = GridShape::new(3, 1, 1).expect("valid grid");
        ExchangeLlgProblem::new(
            grid,
            CellSize::new(1.0, 1.0, 1.0).expect("valid cell size"),
            MaterialParameters::new(1.0, 0.5 * MU0, alpha).expect("valid material"),
            LlgConfig::new(gamma, TimeIntegrator::Heun).expect("valid llg config"),
        )
    }

    fn zeeman_problem(field: Vector3) -> ExchangeLlgProblem {
        let grid = GridShape::new(2, 1, 1).expect("valid grid");
        ExchangeLlgProblem::with_terms(
            grid,
            CellSize::new(1.0, 1.0, 1.0).expect("valid cell size"),
            MaterialParameters::new(1.0, 0.5 * MU0, 0.5).expect("valid material"),
            LlgConfig::new(1.0, TimeIntegrator::Heun).expect("valid llg config"),
            EffectiveFieldTerms {
                exchange: false,
                demag: false,
                external_field: Some(field),
            },
        )
    }

    fn demag_problem(nx: usize, ny: usize, nz: usize) -> ExchangeLlgProblem {
        let grid = GridShape::new(nx, ny, nz).expect("valid grid");
        ExchangeLlgProblem::with_terms(
            grid,
            CellSize::new(1.0, 1.0, 0.2).expect("valid cell size"),
            MaterialParameters::new(1.0, 0.5 * MU0, 0.1).expect("valid material"),
            LlgConfig::new(1.0, TimeIntegrator::Heun).expect("valid llg config"),
            EffectiveFieldTerms {
                exchange: false,
                demag: true,
                external_field: None,
            },
        )
    }

    fn assert_vector_close(actual: Vector3, expected: Vector3, tolerance: f64) {
        for component in 0..3 {
            assert!(
                (actual[component] - expected[component]).abs() <= tolerance,
                "component {component} differs: actual={:?}, expected={:?}",
                actual,
                expected
            );
        }
    }

    #[test]
    fn uniform_state_has_zero_exchange_field_and_rhs() {
        let problem = simple_problem(0.1, 1.0);
        let state = problem
            .uniform_state([1.0, 0.0, 0.0])
            .expect("uniform state should build");

        let field = problem
            .exchange_field(&state)
            .expect("exchange field should evaluate");
        let rhs = problem.llg_rhs(&state).expect("rhs should evaluate");

        for value in field.iter().chain(rhs.iter()) {
            assert_vector_close(*value, [0.0, 0.0, 0.0], 1e-12);
        }
        assert!(
            problem
                .exchange_energy(&state)
                .expect("energy should evaluate")
                <= 1e-12,
            "uniform state should have zero exchange energy"
        );
    }

    #[test]
    fn center_exchange_field_matches_second_difference_stencil() {
        let problem = simple_problem(0.0, 1.0);
        let state = problem
            .new_state(vec![[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [1.0, 0.0, 0.0]])
            .expect("state should build");

        let field = problem
            .exchange_field(&state)
            .expect("exchange field should evaluate");

        assert_vector_close(field[1], [2.0, -2.0, 0.0], 1e-12);
    }

    #[test]
    fn heun_step_preserves_unit_norm() {
        let problem = simple_problem(0.1, 1.0);
        let mut state = problem
            .new_state(vec![[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [1.0, 0.0, 0.0]])
            .expect("state should build");

        let _report = problem.step(&mut state, 1e-3).expect("step should succeed");

        for magnetization in state.magnetization() {
            assert!(
                (norm(*magnetization) - 1.0).abs() <= 1e-12,
                "magnetization lost unit norm: {:?}",
                magnetization
            );
        }
    }

    #[test]
    fn damped_relaxation_reduces_exchange_energy_for_small_dt() {
        let problem = simple_problem(0.5, 1.0);
        let mut state = problem
            .new_state(vec![[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [1.0, 0.0, 0.0]])
            .expect("state should build");

        let initial_energy = problem
            .exchange_energy(&state)
            .expect("energy should evaluate");
        for _ in 0..10 {
            problem.step(&mut state, 1e-3).expect("step should succeed");
        }
        let final_energy = problem.observe(&state).expect("observables").total_energy_joules;

        assert!(
            final_energy < initial_energy,
            "expected damped exchange relaxation to reduce energy, initial={initial_energy}, final={final_energy}"
        );
    }

    #[test]
    fn zeeman_only_relaxation_reduces_external_energy() {
        let problem = zeeman_problem([0.0, 0.0, 1.0]);
        let mut state = problem
            .new_state(vec![[1.0, 0.0, 0.0], [1.0, 0.0, 0.0]])
            .expect("state should build");

        let initial_energy = problem.observe(&state).expect("observables").external_energy_joules;
        for _ in 0..100 {
            problem.step(&mut state, 5e-3).expect("step should succeed");
        }
        let final_observables = problem.observe(&state).expect("observables");

        assert!(
            final_observables.external_energy_joules < initial_energy,
            "expected external energy to decrease under damping"
        );
        assert!(
            state.magnetization()[0][2] > 0.1,
            "magnetization should tilt toward the external field"
        );
    }

    #[test]
    fn thin_film_out_of_plane_demag_energy_exceeds_in_plane_energy() {
        let problem = demag_problem(4, 4, 1);
        let out_of_plane = problem
            .uniform_state([0.0, 0.0, 1.0])
            .expect("state should build");
        let in_plane = problem
            .uniform_state([1.0, 0.0, 0.0])
            .expect("state should build");

        let e_out = problem.observe(&out_of_plane).expect("observables").demag_energy_joules;
        let e_in = problem.observe(&in_plane).expect("observables").demag_energy_joules;

        assert!(
            e_out > e_in,
            "thin-film demag should penalise out-of-plane magnetization more strongly, out={e_out}, in={e_in}"
        );
    }
}
