use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

pub const IR_VERSION: &str = "0.2.0";

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ExecutionMode {
    Strict,
    Extended,
    Hybrid,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum BackendTarget {
    Auto,
    Fdm,
    Fem,
    Hybrid,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ExecutionPrecision {
    Single,
    Double,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum IntegratorChoice {
    Heun,
    Rk4,
    Rk23,
    Rk45,
    Abm3,
}

fn vec3_from_value(value: &Value) -> Option<[f64; 3]> {
    let array = value.as_array()?;
    if array.len() != 3 {
        return None;
    }
    Some([array[0].as_f64()?, array[1].as_f64()?, array[2].as_f64()?])
}

fn normalized_bounds_pair(bounds_min: ([f64; 3], [f64; 3])) -> Option<([f64; 3], [f64; 3])> {
    let (bounds_min, bounds_max) = bounds_min;
    let normalized_min = [
        bounds_min[0].min(bounds_max[0]),
        bounds_min[1].min(bounds_max[1]),
        bounds_min[2].min(bounds_max[2]),
    ];
    let normalized_max = [
        bounds_min[0].max(bounds_max[0]),
        bounds_min[1].max(bounds_max[1]),
        bounds_min[2].max(bounds_max[2]),
    ];
    if normalized_max
        .iter()
        .zip(normalized_min.iter())
        .any(|(max_value, min_value)| *max_value - *min_value <= 0.0)
    {
        return None;
    }
    Some((normalized_min, normalized_max))
}

fn option_bounds_pair(
    bounds_min: Option<[f64; 3]>,
    bounds_max: Option<[f64; 3]>,
) -> Option<([f64; 3], [f64; 3])> {
    normalized_bounds_pair((bounds_min?, bounds_max?))
}

fn bounds_extent(bounds_min: [f64; 3], bounds_max: [f64; 3]) -> [f64; 3] {
    [
        bounds_max[0] - bounds_min[0],
        bounds_max[1] - bounds_min[1],
        bounds_max[2] - bounds_min[2],
    ]
}

fn bounds_center(bounds_min: [f64; 3], bounds_max: [f64; 3]) -> [f64; 3] {
    [
        0.5 * (bounds_min[0] + bounds_max[0]),
        0.5 * (bounds_min[1] + bounds_max[1]),
        0.5 * (bounds_min[2] + bounds_max[2]),
    ]
}

/// Algorithm selection for relaxation (energy-minimization) studies.
///
/// See `docs/physics/0500-fdm-relaxation-algorithms.md` for full specification.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RelaxationAlgorithmIR {
    /// Overdamped Landau–Lifshitz–Gilbert time-stepping with high damping.
    /// Reuses the standard LLG integration pipeline.  Public-executable on FDM and FEM.
    LlgOverdamped,
    /// Projected steepest descent with Barzilai–Borwein step selection on the
    /// sphere product manifold.  Uses alternating BB1/BB2 step sizes with Armijo
    /// backtracking line search.  Public-executable on FDM.
    ProjectedGradientBb,
    /// Nonlinear conjugate gradient (Polak–Ribière+) with tangent-space vector
    /// transport, periodic restarts, and Armijo backtracking.  Public-executable
    /// on FDM.
    NonlinearCg,
    /// FEM-only linearly implicit tangent-plane relaxation.  Semantic-only;
    /// execution deferred until FEM tangent-space infrastructure is ready.
    TangentPlaneImplicit,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ExchangeBoundaryCondition {
    Neumann,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum ImportedGeometryScaleIR {
    Uniform(f64),
    Anisotropic([f64; 3]),
}

impl Default for ImportedGeometryScaleIR {
    fn default() -> Self {
        Self::Uniform(1.0)
    }
}

impl ImportedGeometryScaleIR {
    pub fn is_positive(&self) -> bool {
        match self {
            Self::Uniform(scale) => *scale > 0.0,
            Self::Anisotropic(scale) => scale.iter().all(|component| *component > 0.0),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ProblemMeta {
    pub name: String,
    pub description: Option<String>,
    pub script_language: String,
    pub script_source: Option<String>,
    pub script_api_version: String,
    pub serializer_version: String,
    pub entrypoint_kind: String,
    pub source_hash: Option<String>,
    pub runtime_metadata: BTreeMap<String, Value>,
    pub backend_revision: Option<String>,
    pub seeds: Vec<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct GeometryIR {
    pub entries: Vec<GeometryEntryIR>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum GeometryEntryIR {
    ImportedGeometry {
        name: String,
        source: String,
        format: String,
        #[serde(default)]
        scale: ImportedGeometryScaleIR,
    },
    Box {
        name: String,
        size: [f64; 3],
    },
    Cylinder {
        name: String,
        radius: f64,
        height: f64,
    },
    Ellipsoid {
        name: String,
        radii: [f64; 3],
    },
    Sphere {
        name: String,
        radius: f64,
    },
    Ellipse {
        name: String,
        radii: [f64; 2],
        height: f64,
    },
    Difference {
        name: String,
        base: std::boxed::Box<GeometryEntryIR>,
        tool: std::boxed::Box<GeometryEntryIR>,
    },
    Union {
        name: String,
        a: std::boxed::Box<GeometryEntryIR>,
        b: std::boxed::Box<GeometryEntryIR>,
    },
    Intersection {
        name: String,
        a: std::boxed::Box<GeometryEntryIR>,
        b: std::boxed::Box<GeometryEntryIR>,
    },
    Translate {
        name: String,
        base: std::boxed::Box<GeometryEntryIR>,
        by: [f64; 3],
    },
}

impl GeometryEntryIR {
    pub fn name(&self) -> &str {
        match self {
            Self::ImportedGeometry { name, .. }
            | Self::Box { name, .. }
            | Self::Cylinder { name, .. }
            | Self::Ellipsoid { name, .. }
            | Self::Sphere { name, .. }
            | Self::Ellipse { name, .. }
            | Self::Difference { name, .. }
            | Self::Union { name, .. }
            | Self::Intersection { name, .. }
            | Self::Translate { name, .. } => name,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RegionIR {
    pub name: String,
    pub geometry: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MaterialIR {
    pub name: String,
    pub saturation_magnetisation: f64,
    pub exchange_stiffness: f64,
    pub damping: f64,
    pub uniaxial_anisotropy: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub uniaxial_anisotropy_k2: Option<f64>,
    pub anisotropy_axis: Option<[f64; 3]>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cubic_anisotropy_kc1: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cubic_anisotropy_kc2: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cubic_anisotropy_kc3: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cubic_anisotropy_axis1: Option<[f64; 3]>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cubic_anisotropy_axis2: Option<[f64; 3]>,
    // Per-node spatially varying fields (when Some, override the scalar)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ms_field: Option<Vec<f64>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub a_field: Option<Vec<f64>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub alpha_field: Option<Vec<f64>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ku_field: Option<Vec<f64>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ku2_field: Option<Vec<f64>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kc1_field: Option<Vec<f64>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kc2_field: Option<Vec<f64>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kc3_field: Option<Vec<f64>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MagnetIR {
    pub name: String,
    pub region: String,
    pub material: String,
    pub initial_magnetization: Option<InitialMagnetizationIR>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum InitialMagnetizationIR {
    Uniform { value: [f64; 3] },
    RandomSeeded { seed: u64 },
    SampledField { values: Vec<[f64; 3]> },
}

/// Time-dependence envelope for fields and currents.
///
/// The effective value at time `t` is: `amplitude(t) = base * f(t)`
/// where `f(t)` is defined by the variant.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum TimeDependenceIR {
    /// Constant: f(t) = 1
    Constant,
    /// Sinusoidal: f(t) = sin(2π·freq·t + phase) + offset
    Sinusoidal {
        frequency_hz: f64,
        #[serde(default)]
        phase_rad: f64,
        #[serde(default)]
        offset: f64,
    },
    /// Rectangular pulse: f(t) = 1 for t_on ≤ t < t_off, else 0
    Pulse { t_on: f64, t_off: f64 },
    /// Piecewise linear: pairs of (time, value), linearly interpolated
    PiecewiseLinear { points: Vec<[f64; 2]> },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RfDriveIR {
    pub current_a: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub waveform: Option<TimeDependenceIR>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AntennaIR {
    Microstrip {
        width: f64,
        thickness: f64,
        height_above_magnet: f64,
        preview_length: f64,
        #[serde(default)]
        center_x: f64,
        #[serde(default)]
        center_y: f64,
        #[serde(default = "default_current_distribution_uniform")]
        current_distribution: String,
    },
    Cpw {
        signal_width: f64,
        gap: f64,
        ground_width: f64,
        thickness: f64,
        height_above_magnet: f64,
        preview_length: f64,
        #[serde(default)]
        center_x: f64,
        #[serde(default)]
        center_y: f64,
        #[serde(default = "default_current_distribution_uniform")]
        current_distribution: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum CurrentModuleIR {
    AntennaFieldSource {
        name: String,
        solver: String,
        antenna: AntennaIR,
        drive: RfDriveIR,
        #[serde(default = "default_antenna_air_box_factor")]
        air_box_factor: f64,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ExcitationAnalysisIR {
    pub source: String,
    pub method: String,
    pub propagation_axis: [f64; 3],
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub k_max_rad_per_m: Option<f64>,
    pub samples: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum EnergyTermIR {
    Exchange,
    Demag {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        realization: Option<String>,
    },
    InterfacialDmi {
        #[serde(rename = "D")]
        d: f64,
    },
    BulkDmi {
        #[serde(rename = "D")]
        d: f64,
    },
    Zeeman {
        #[serde(rename = "B")]
        b: [f64; 3],
    },
    /// Oersted field from a cylindrical conductor (STNO / MTJ pillar).
    ///
    /// The static spatial profile H_oe(x,y,z) is precomputed on the GPU
    /// for I = 1 A, then scaled by `current * time_dependence(t)` at each
    /// RHS evaluation.
    OerstedCylinder {
        /// DC current amplitude [A].  Sign determines field chirality.
        current: f64,
        /// Cylinder radius [m].
        radius: f64,
        /// Centre of the cylinder cross-section [m]. Only the two in-plane
        /// components matter (the third is ignored and taken along `axis`).
        #[serde(default)]
        center: [f64; 3],
        /// Cylinder / current-flow axis (unit vector, default +z).
        #[serde(default = "default_axis_z")]
        axis: [f64; 3],
        /// Optional time-varying envelope for the current.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        time_dependence: Option<TimeDependenceIR>,
    },
    /// Magnetoelastic coupling energy between a magnet and an elastic body.
    Magnetoelastic {
        /// Name of the MagnetIR.
        magnet: String,
        /// Name of the ElasticBodyIR.
        body: String,
        /// Name of the MagnetostrictionLawIR.
        law: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum DynamicsIR {
    Llg {
        gyromagnetic_ratio: f64,
        integrator: String,
        fixed_timestep: Option<f64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        adaptive_timestep: Option<AdaptiveTimeStepIR>,
        /// Optional mechanical coupling mode.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        mechanics: Option<MechanicsIR>,
    },
}

/// Adaptive time-stepping configuration for embedded-error RK methods.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AdaptiveTimeStepIR {
    pub atol: f64,
    pub rtol: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dt_initial: Option<f64>,
    pub dt_min: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dt_max: Option<f64>,
    pub safety: f64,
    pub growth_limit: f64,
    pub shrink_limit: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_spin_rotation: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub norm_tolerance: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SamplingIR {
    pub outputs: Vec<OutputIR>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EigenOperatorIR {
    LinearizedLlg,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct EigenOperatorConfigIR {
    pub kind: EigenOperatorIR,
    #[serde(default)]
    pub include_demag: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum EigenTargetIR {
    Lowest,
    Nearest { frequency_hz: f64 },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum EquilibriumSourceIR {
    Provided,
    RelaxedInitialState,
    Artifact { path: String },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum KSamplingIR {
    Single { k_vector: [f64; 3] },
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EigenNormalizationIR {
    UnitL2,
    UnitMaxAmplitude,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EigenDampingPolicyIR {
    Ignore,
    Include,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum StudyIR {
    TimeEvolution {
        dynamics: DynamicsIR,
        sampling: SamplingIR,
    },
    Relaxation {
        algorithm: RelaxationAlgorithmIR,
        dynamics: DynamicsIR,
        torque_tolerance: f64,
        #[serde(skip_serializing_if = "Option::is_none")]
        energy_tolerance: Option<f64>,
        max_steps: u64,
        sampling: SamplingIR,
    },
    Eigenmodes {
        dynamics: DynamicsIR,
        operator: EigenOperatorConfigIR,
        count: u32,
        target: EigenTargetIR,
        equilibrium: EquilibriumSourceIR,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        k_sampling: Option<KSamplingIR>,
        normalization: EigenNormalizationIR,
        damping_policy: EigenDampingPolicyIR,
        sampling: SamplingIR,
    },
}

impl StudyIR {
    pub fn dynamics(&self) -> &DynamicsIR {
        match self {
            StudyIR::TimeEvolution { dynamics, .. }
            | StudyIR::Relaxation { dynamics, .. }
            | StudyIR::Eigenmodes { dynamics, .. } => dynamics,
        }
    }

    pub fn sampling(&self) -> &SamplingIR {
        match self {
            StudyIR::TimeEvolution { sampling, .. }
            | StudyIR::Relaxation { sampling, .. }
            | StudyIR::Eigenmodes { sampling, .. } => sampling,
        }
    }

    pub fn relaxation(&self) -> Option<RelaxationControlIR> {
        match self {
            StudyIR::TimeEvolution { .. } | StudyIR::Eigenmodes { .. } => None,
            StudyIR::Relaxation {
                algorithm,
                torque_tolerance,
                energy_tolerance,
                max_steps,
                ..
            } => Some(RelaxationControlIR {
                algorithm: *algorithm,
                torque_tolerance: *torque_tolerance,
                energy_tolerance: *energy_tolerance,
                max_steps: *max_steps,
            }),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum OutputIR {
    Field {
        name: String,
        every_seconds: f64,
    },
    Scalar {
        name: String,
        every_seconds: f64,
    },
    Snapshot {
        field: String,
        component: String,
        every_seconds: f64,
        #[serde(skip_serializing_if = "Option::is_none")]
        layer: Option<String>,
    },
    EigenSpectrum {
        quantity: String,
    },
    EigenMode {
        field: String,
        indices: Vec<u32>,
    },
    DispersionCurve {
        name: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct BackendPolicyIR {
    pub requested_backend: BackendTarget,
    pub execution_precision: ExecutionPrecision,
    pub discretization_hints: Option<DiscretizationHintsIR>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DiscretizationHintsIR {
    pub fdm: Option<FdmHintsIR>,
    pub fem: Option<FemHintsIR>,
    pub hybrid: Option<HybridHintsIR>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FdmHintsIR {
    /// Legacy single-cell hint (backward compatible).
    pub cell: [f64; 3],
    /// New: explicit default cell (may differ from `cell` in future).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_cell: Option<[f64; 3]>,
    /// Per-magnet native grid overrides, keyed by magnet name.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub per_magnet: Option<std::collections::BTreeMap<String, FdmGridHintsIR>>,
    /// Demagnetization solver policy.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub demag: Option<FdmDemagHintsIR>,
    /// Boundary correction: "none" | "volume" (T0) | "full" (T1)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub boundary_correction: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FdmGridHintsIR {
    pub cell: [f64; 3],
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FdmDemagHintsIR {
    pub strategy: String,
    pub mode: String,
    #[serde(default)]
    pub allow_single_grid_fallback: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub common_cells: Option<[u32; 3]>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub common_cells_xy: Option<[u32; 2]>,
}

// ---------------------------------------------------------------------------
// Multilayer convolution plan IR types
// ---------------------------------------------------------------------------
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FdmMultilayerPlanIR {
    pub mode: String,
    pub common_cells: [u32; 3],
    pub layers: Vec<FdmLayerPlanIR>,
    pub enable_exchange: bool,
    pub enable_demag: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub external_field: Option<[f64; 3]>,
    pub gyromagnetic_ratio: f64,
    pub precision: ExecutionPrecision,
    pub exchange_bc: ExchangeBoundaryCondition,
    pub integrator: IntegratorChoice,
    pub fixed_timestep: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub relaxation: Option<RelaxationControlIR>,
    pub planner_summary: FdmMultilayerSummaryIR,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FdmLayerPlanIR {
    pub magnet_name: String,
    pub native_grid: [u32; 3],
    pub native_cell_size: [f64; 3],
    pub native_origin: [f64; 3],
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub native_active_mask: Option<Vec<bool>>,
    pub initial_magnetization: Vec<[f64; 3]>,
    pub material: FdmMaterialIR,
    pub convolution_grid: [u32; 3],
    pub convolution_cell_size: [f64; 3],
    pub convolution_origin: [f64; 3],
    pub transfer_kind: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FdmMultilayerSummaryIR {
    pub requested_strategy: String,
    pub selected_strategy: String,
    pub eligibility: String,
    pub estimated_pair_kernels: u32,
    pub estimated_unique_kernels: u32,
    pub estimated_kernel_bytes: u64,
    #[serde(default)]
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FemHintsIR {
    pub order: u32,
    pub hmax: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mesh: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MeshIR {
    pub mesh_name: String,
    pub nodes: Vec<[f64; 3]>,
    pub elements: Vec<[u32; 4]>,
    pub element_markers: Vec<u32>,
    pub boundary_faces: Vec<[u32; 3]>,
    pub boundary_markers: Vec<u32>,
}

impl MeshIR {
    pub fn validate(&self) -> Result<(), Vec<String>> {
        let mut errors = Vec::new();

        if self.mesh_name.trim().is_empty() {
            errors.push("mesh_name must not be empty".to_string());
        }
        if self.nodes.is_empty() {
            errors.push("mesh.nodes must not be empty".to_string());
        }
        if self.elements.is_empty() {
            errors.push("mesh.elements must not be empty".to_string());
        }
        if self.element_markers.len() != self.elements.len() {
            errors.push("mesh.element_markers length must match mesh.elements length".to_string());
        }
        if self.boundary_markers.len() != self.boundary_faces.len() {
            errors.push(
                "mesh.boundary_markers length must match mesh.boundary_faces length".to_string(),
            );
        }

        let node_count = self.nodes.len() as u32;
        for (index, element) in self.elements.iter().enumerate() {
            if element.iter().any(|node| *node >= node_count) {
                errors.push(format!("mesh element {index} contains invalid node index"));
            }
        }
        for (index, face) in self.boundary_faces.iter().enumerate() {
            if face.iter().any(|node| *node >= node_count) {
                errors.push(format!(
                    "mesh boundary face {index} contains invalid node index"
                ));
            }
        }

        if errors.is_empty() {
            Ok(())
        } else {
            Err(errors)
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FdmGridAssetIR {
    pub geometry_name: String,
    pub cells: [u32; 3],
    pub cell_size: [f64; 3],
    pub origin: [f64; 3],
    pub active_mask: Vec<bool>,
}

impl FdmGridAssetIR {
    pub fn validate(&self) -> Result<(), Vec<String>> {
        let mut errors = Vec::new();

        if self.geometry_name.trim().is_empty() {
            errors.push("fdm_grid_asset.geometry_name must not be empty".to_string());
        }
        for (axis, value) in ["x", "y", "z"].iter().zip(self.cells.iter()) {
            if *value == 0 {
                errors.push(format!("fdm_grid_asset.cells[{axis}] must be > 0"));
            }
        }
        for (axis, value) in ["x", "y", "z"].iter().zip(self.cell_size.iter()) {
            if *value <= 0.0 {
                errors.push(format!("fdm_grid_asset.cell_size[{axis}] must be positive"));
            }
        }

        let expected = self.cells[0] as usize * self.cells[1] as usize * self.cells[2] as usize;
        if self.active_mask.len() != expected {
            errors.push(format!(
                "fdm_grid_asset.active_mask length ({}) must match cells product ({expected})",
                self.active_mask.len()
            ));
        }
        if !self.active_mask.iter().any(|active| *active) {
            errors.push(
                "fdm_grid_asset.active_mask must contain at least one active cell".to_string(),
            );
        }

        if errors.is_empty() {
            Ok(())
        } else {
            Err(errors)
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FemMeshAssetIR {
    pub geometry_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mesh_source: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mesh: Option<MeshIR>,
}

impl FemMeshAssetIR {
    pub fn validate(&self) -> Result<(), Vec<String>> {
        let mut errors = Vec::new();

        if self.geometry_name.trim().is_empty() {
            errors.push("fem_mesh_asset.geometry_name must not be empty".to_string());
        }
        if self.mesh.is_none() && self.mesh_source.is_none() {
            errors.push(
                "fem_mesh_asset must provide either an inline mesh or mesh_source".to_string(),
            );
        }
        if let Some(mesh) = &self.mesh {
            if let Err(mesh_errors) = mesh.validate() {
                errors.extend(
                    mesh_errors
                        .into_iter()
                        .map(|error| format!("fem_mesh_asset.{}", error)),
                );
            }
        }

        if errors.is_empty() {
            Ok(())
        } else {
            Err(errors)
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FemDomainRegionMarkerIR {
    pub geometry_name: String,
    pub marker: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FemDomainMeshAssetIR {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mesh_source: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mesh: Option<MeshIR>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub region_markers: Vec<FemDomainRegionMarkerIR>,
}

impl FemDomainMeshAssetIR {
    pub fn validate(&self) -> Result<(), Vec<String>> {
        let mut errors = Vec::new();
        if self.mesh.is_none() && self.mesh_source.is_none() {
            errors.push(
                "fem_domain_mesh_asset must provide either an inline mesh or mesh_source"
                    .to_string(),
            );
        }
        if let Some(mesh) = &self.mesh {
            if let Err(mesh_errors) = mesh.validate() {
                errors.extend(
                    mesh_errors
                        .into_iter()
                        .map(|error| format!("fem_domain_mesh_asset.{error}")),
                );
            }
        }
        let mut seen_markers = BTreeSet::new();
        let mut seen_geometries = BTreeSet::new();
        for region in &self.region_markers {
            if region.geometry_name.trim().is_empty() {
                errors.push(
                    "fem_domain_mesh_asset.region_markers geometry_name must not be empty"
                        .to_string(),
                );
            }
            if region.marker == 0 {
                errors.push(
                    "fem_domain_mesh_asset.region_markers markers must be > 0".to_string(),
                );
            }
            if !seen_markers.insert(region.marker) {
                errors.push(format!(
                    "fem_domain_mesh_asset.region_markers marker {} is duplicated",
                    region.marker
                ));
            }
            if !seen_geometries.insert(region.geometry_name.as_str()) {
                errors.push(format!(
                    "fem_domain_mesh_asset.region_markers geometry '{}' is duplicated",
                    region.geometry_name
                ));
            }
        }
        if errors.is_empty() {
            Ok(())
        } else {
            Err(errors)
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct GeometryAssetsIR {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub fdm_grid_assets: Vec<FdmGridAssetIR>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub fem_mesh_assets: Vec<FemMeshAssetIR>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fem_domain_mesh_asset: Option<FemDomainMeshAssetIR>,
}

impl GeometryAssetsIR {
    pub fn validate(&self) -> Result<(), Vec<String>> {
        let mut errors = Vec::new();
        for asset in &self.fdm_grid_assets {
            if let Err(asset_errors) = asset.validate() {
                errors.extend(
                    asset_errors
                        .into_iter()
                        .map(|error| format!("geometry_assets.{error}")),
                );
            }
        }
        for asset in &self.fem_mesh_assets {
            if let Err(asset_errors) = asset.validate() {
                errors.extend(
                    asset_errors
                        .into_iter()
                        .map(|error| format!("geometry_assets.{error}")),
                );
            }
        }
        if let Some(asset) = &self.fem_domain_mesh_asset {
            if let Err(asset_errors) = asset.validate() {
                errors.extend(
                    asset_errors
                        .into_iter()
                        .map(|error| format!("geometry_assets.{error}")),
                );
            }
        }
        if errors.is_empty() {
            Ok(())
        } else {
            Err(errors)
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DeclaredUniverseIR {
    pub mode: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size: Option<[f64; 3]>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub center: Option<[f64; 3]>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub padding: Option<[f64; 3]>,
}

impl Default for DeclaredUniverseIR {
    fn default() -> Self {
        Self {
            mode: "auto".to_string(),
            size: None,
            center: None,
            padding: None,
        }
    }
}

impl DeclaredUniverseIR {
    pub fn from_study_universe_value(value: &Value) -> Option<Self> {
        let object = value.as_object()?;
        Some(Self {
            mode: object
                .get("mode")
                .and_then(|candidate| candidate.as_str())
                .unwrap_or("auto")
                .to_string(),
            size: object.get("size").and_then(vec3_from_value),
            center: object.get("center").and_then(vec3_from_value),
            padding: object.get("padding").and_then(vec3_from_value),
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct DomainFrameIR {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub declared_universe: Option<DeclaredUniverseIR>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub object_bounds_min: Option<[f64; 3]>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub object_bounds_max: Option<[f64; 3]>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mesh_bounds_min: Option<[f64; 3]>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mesh_bounds_max: Option<[f64; 3]>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub effective_extent: Option<[f64; 3]>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub effective_center: Option<[f64; 3]>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub effective_source: Option<String>,
}

impl DomainFrameIR {
    pub fn with_mesh_bounds(mut self, mesh_bounds: Option<([f64; 3], [f64; 3])>) -> Self {
        if let Some((bounds_min, bounds_max)) = mesh_bounds.and_then(normalized_bounds_pair) {
            self.mesh_bounds_min = Some(bounds_min);
            self.mesh_bounds_max = Some(bounds_max);
        }
        self
    }

    pub fn finalized(mut self) -> Option<Self> {
        let object_bounds = option_bounds_pair(self.object_bounds_min, self.object_bounds_max);
        let mesh_bounds = option_bounds_pair(self.mesh_bounds_min, self.mesh_bounds_max);
        let declared_universe = self.declared_universe.clone();

        if self.effective_extent.is_none() {
            if let Some(declared) = declared_universe.as_ref() {
                if declared.mode == "manual" {
                    if let Some(size) = declared.size {
                        self.effective_extent = Some(size);
                        self.effective_source
                            .get_or_insert_with(|| "declared_universe_manual".to_string());
                    }
                    if self.effective_center.is_none() {
                        self.effective_center = declared
                            .center
                            .or_else(|| {
                                object_bounds.map(|bounds| bounds_center(bounds.0, bounds.1))
                            })
                            .or_else(|| {
                                mesh_bounds.map(|bounds| bounds_center(bounds.0, bounds.1))
                            });
                    }
                } else {
                    let base_bounds = object_bounds.or(mesh_bounds);
                    if let Some((bounds_min, bounds_max)) = base_bounds {
                        let padding = declared.padding.unwrap_or([0.0, 0.0, 0.0]);
                        let base_extent = bounds_extent(bounds_min, bounds_max);
                        if padding.iter().any(|component| component.abs() > 0.0) {
                            self.effective_extent = Some([
                                base_extent[0] + 2.0 * padding[0],
                                base_extent[1] + 2.0 * padding[1],
                                base_extent[2] + 2.0 * padding[2],
                            ]);
                            self.effective_source.get_or_insert_with(|| {
                                "declared_universe_auto_padding".to_string()
                            });
                        } else {
                            self.effective_extent = Some(base_extent);
                            self.effective_source.get_or_insert_with(|| {
                                if object_bounds.is_some() {
                                    "object_union_bounds".to_string()
                                } else {
                                    "mesh_bounds".to_string()
                                }
                            });
                        }
                        if self.effective_center.is_none() {
                            self.effective_center = Some(bounds_center(bounds_min, bounds_max));
                        }
                    }
                }
            } else if let Some((bounds_min, bounds_max)) = object_bounds {
                self.effective_extent = Some(bounds_extent(bounds_min, bounds_max));
                self.effective_center = Some(bounds_center(bounds_min, bounds_max));
                self.effective_source
                    .get_or_insert_with(|| "object_union_bounds".to_string());
            } else if let Some((bounds_min, bounds_max)) = mesh_bounds {
                self.effective_extent = Some(bounds_extent(bounds_min, bounds_max));
                self.effective_center = Some(bounds_center(bounds_min, bounds_max));
                self.effective_source
                    .get_or_insert_with(|| "mesh_bounds".to_string());
            }
        }

        if self.declared_universe.is_none()
            && self.object_bounds_min.is_none()
            && self.object_bounds_max.is_none()
            && self.mesh_bounds_min.is_none()
            && self.mesh_bounds_max.is_none()
            && self.effective_extent.is_none()
            && self.effective_center.is_none()
            && self.effective_source.is_none()
        {
            None
        } else {
            Some(self)
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HybridHintsIR {
    pub demag: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ValidationProfileIR {
    pub execution_mode: ExecutionMode,
}

// ---------------------------------------------------------------------------
// Magnetoelastic IR types
// ---------------------------------------------------------------------------

/// Linear elastic material with cubic symmetry constants.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ElasticMaterialIR {
    pub name: String,
    /// Elastic constant C11 [Pa].
    pub c11: f64,
    /// Elastic constant C12 [Pa].
    pub c12: f64,
    /// Elastic constant C44 [Pa].
    pub c44: f64,
    /// Mass density [kg/m³].
    pub density: f64,
    /// Mechanical damping coefficient (dimensionless, for elastodynamics).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mechanical_damping: Option<f64>,
}

/// Elastic domain bound to a geometry and an elastic material.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ElasticBodyIR {
    pub name: String,
    /// References a GeometryIR entry name.
    pub geometry: String,
    /// References an ElasticMaterialIR name.
    pub elastic_material: String,
}

/// Magnetostriction coupling law.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum MagnetostrictionLawIR {
    /// Cubic magnetostriction: B1, B2 coupling constants [Pa].
    Cubic { name: String, b1: f64, b2: f64 },
    /// Isotropic magnetostriction: saturation magnetostriction λ_s [1].
    Isotropic { name: String, lambda_s: f64 },
}

impl MagnetostrictionLawIR {
    pub fn name(&self) -> &str {
        match self {
            Self::Cubic { name, .. } | Self::Isotropic { name, .. } => name,
        }
    }
}

/// Mechanical boundary condition.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum MechanicalBoundaryConditionIR {
    TractionFree { surface: String },
    Clamped { surface: String },
    PrescribedDisplacement { surface: String, u: [f64; 3] },
    PrescribedTraction { surface: String, t: [f64; 3] },
}

/// External mechanical load.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum MechanicalLoadIR {
    BodyForce { f: [f64; 3] },
    PrescribedStrain { strain: [f64; 6] },
    PrescribedStress { stress: [f64; 6] },
}

/// Mechanical coupling mode within DynamicsIR.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum MechanicsIR {
    PrescribedStrain,
    QuasistaticElasticity {
        max_picard_iterations: u32,
        picard_tolerance: f64,
    },
    Elastodynamics {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        mechanical_dt: Option<f64>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ProblemIR {
    pub ir_version: String,
    pub problem_meta: ProblemMeta,
    pub geometry: GeometryIR,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub geometry_assets: Option<GeometryAssetsIR>,
    pub regions: Vec<RegionIR>,
    pub materials: Vec<MaterialIR>,
    pub magnets: Vec<MagnetIR>,
    pub energy_terms: Vec<EnergyTermIR>,
    pub study: StudyIR,
    pub backend_policy: BackendPolicyIR,
    pub validation_profile: ValidationProfileIR,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub current_modules: Vec<CurrentModuleIR>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub excitation_analysis: Option<ExcitationAnalysisIR>,

    /// Global current density for Zhang-Li STT [A/m^2]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub current_density: Option<[f64; 3]>,
    /// Spin polarization degree for Zhang-Li STT (P)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stt_degree: Option<f64>,
    /// Non-adiabaticity parameter for Zhang-Li STT (beta)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stt_beta: Option<f64>,

    /// Fixed spin polarization vector for Slonczewski STT (p)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stt_spin_polarization: Option<[f64; 3]>,
    /// Slonczewski asymmetry parameter (Lambda)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stt_lambda: Option<f64>,
    /// Slonczewski secondary spin-transfer term (epsilon')
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stt_epsilon_prime: Option<f64>,

    /// Temperature in Kelvin for Brown thermal field (sLLG). None or 0 = no thermal noise.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f64>,

    // ── Magnetoelastic extensions ──────────────────────────
    /// Elastic material definitions.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub elastic_materials: Vec<ElasticMaterialIR>,
    /// Elastic body definitions.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub elastic_bodies: Vec<ElasticBodyIR>,
    /// Magnetostriction coupling law definitions.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub magnetostriction_laws: Vec<MagnetostrictionLawIR>,
    /// Mechanical boundary conditions.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub mechanical_bcs: Vec<MechanicalBoundaryConditionIR>,
    /// External mechanical loads.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub mechanical_loads: Vec<MechanicalLoadIR>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ExecutionPlanSummary {
    pub requested_backend: BackendTarget,
    pub resolved_backend: BackendTarget,
    pub execution_mode: ExecutionMode,
    pub notes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ExecutionPlanIR {
    pub common: CommonPlanMeta,
    pub backend_plan: BackendPlanIR,
    pub output_plan: OutputPlanIR,
    pub provenance: ProvenancePlanIR,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CommonPlanMeta {
    pub ir_version: String,
    pub requested_backend: BackendTarget,
    pub resolved_backend: BackendTarget,
    pub execution_mode: ExecutionMode,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum BackendPlanIR {
    Fdm(FdmPlanIR),
    FdmMultilayer(FdmMultilayerPlanIR),
    Fem(FemPlanIR),
    FemEigen(FemEigenPlanIR),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct GridDimensions {
    pub cells: [u32; 3],
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FdmPlanIR {
    pub grid: GridDimensions,
    pub cell_size: [f64; 3],
    pub region_mask: Vec<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_mask: Option<Vec<bool>>,
    pub initial_magnetization: Vec<[f64; 3]>,
    pub material: FdmMaterialIR,
    pub enable_exchange: bool,
    pub enable_demag: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub external_field: Option<[f64; 3]>,
    /// Inter-region exchange coupling overrides.
    /// Each entry `(region_i, region_j, A_ij)` sets the exchange stiffness [J/m]
    /// between regions i and j (symmetric: A_ij = A_ji).
    /// When empty, cross-region exchange defaults to zero (free-surface BC).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub inter_region_exchange: Vec<(u32, u32, f64)>,
    pub gyromagnetic_ratio: f64,
    pub precision: ExecutionPrecision,
    pub exchange_bc: ExchangeBoundaryCondition,
    pub integrator: IntegratorChoice,
    pub fixed_timestep: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub adaptive_timestep: Option<AdaptiveTimeStepIR>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub relaxation: Option<RelaxationControlIR>,
    /// Boundary correction tier: "none" | "volume" (T0) | "full" (T1)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub boundary_correction: Option<String>,
    /// Sub-cell geometry data (computed by planner when boundary_correction is set).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub boundary_geometry: Option<BoundaryGeometryIR>,
    /// Global current density for Zhang-Li STT [A/m^2]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub current_density: Option<[f64; 3]>,
    /// Spin polarization degree for Zhang-Li STT (P)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stt_degree: Option<f64>,
    /// Non-adiabaticity parameter for Zhang-Li STT (beta)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stt_beta: Option<f64>,

    /// Fixed spin polarization vector for Slonczewski STT (p)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stt_spin_polarization: Option<[f64; 3]>,
    /// Slonczewski asymmetry parameter (Lambda)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stt_lambda: Option<f64>,
    /// Slonczewski secondary spin-transfer term (epsilon')
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stt_epsilon_prime: Option<f64>,

    // ── Oersted field (cylindrical conductor) ──
    /// Whether to include the Oersted field from a cylindrical conductor.
    #[serde(default)]
    pub has_oersted_cylinder: bool,
    /// DC current [A] for Oersted computation.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub oersted_current: Option<f64>,
    /// Cylinder radius [m].
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub oersted_radius: Option<f64>,
    /// Cross-section centre [m].
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub oersted_center: Option<[f64; 3]>,
    /// Current-flow axis (unit vector).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub oersted_axis: Option<[f64; 3]>,
    /// Time-dependence kind: 0=constant, 1=sinusoidal, 2=pulse
    #[serde(default)]
    pub oersted_time_dep_kind: u32,
    /// Sinusoidal: frequency [Hz]
    #[serde(default)]
    pub oersted_time_dep_freq: f64,
    /// Sinusoidal: phase [rad]
    #[serde(default)]
    pub oersted_time_dep_phase: f64,
    /// Sinusoidal: offset
    #[serde(default)]
    pub oersted_time_dep_offset: f64,
    /// Pulse: t_on [s]
    #[serde(default)]
    pub oersted_time_dep_t_on: f64,
    /// Pulse: t_off [s]
    #[serde(default)]
    pub oersted_time_dep_t_off: f64,

    /// Temperature in Kelvin for Brown thermal field (sLLG). None or 0 = no thermal noise.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f64>,
}

/// Sub-cell boundary geometry arrays computed from SDF during planning.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct BoundaryGeometryIR {
    /// Per-cell volume fraction φ ∈ [0,1], length = cell_count.
    pub volume_fraction: Vec<f64>,
    /// Face-link fractions per direction, each length = cell_count.
    pub face_link_xp: Vec<f64>,
    pub face_link_xm: Vec<f64>,
    pub face_link_yp: Vec<f64>,
    pub face_link_ym: Vec<f64>,
    pub face_link_zp: Vec<f64>,
    pub face_link_zm: Vec<f64>,
    /// Intersection distances per direction (T1 only), each length = cell_count.
    pub delta_xp: Vec<f64>,
    pub delta_xm: Vec<f64>,
    pub delta_yp: Vec<f64>,
    pub delta_ym: Vec<f64>,
    pub delta_zp: Vec<f64>,
    pub delta_zm: Vec<f64>,
    /// Sparse demag correction data (T0+T1).
    #[serde(default)]
    pub demag_corr_target_idx: Vec<i32>,
    #[serde(default)]
    pub demag_corr_source_idx: Vec<i32>,
    #[serde(default)]
    pub demag_corr_tensor: Vec<f64>,
    #[serde(default)]
    pub demag_corr_stencil_size: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FdmMaterialIR {
    pub name: String,
    pub saturation_magnetisation: f64,
    pub exchange_stiffness: f64,
    pub damping: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FemObjectSegmentIR {
    pub object_id: String,
    pub node_start: u32,
    pub node_count: u32,
    pub element_start: u32,
    pub element_count: u32,
    pub boundary_face_start: u32,
    pub boundary_face_count: u32,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum FemDomainMeshModeIR {
    #[default]
    MergedMagneticMesh,
    SharedDomainMeshWithAir,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FemPlanIR {
    pub mesh_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mesh_source: Option<String>,
    pub mesh: MeshIR,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub object_segments: Vec<FemObjectSegmentIR>,
    #[serde(default)]
    pub domain_mesh_mode: FemDomainMeshModeIR,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub domain_frame: Option<DomainFrameIR>,
    pub fe_order: u32,
    pub hmax: f64,
    pub initial_magnetization: Vec<[f64; 3]>,
    pub material: MaterialIR,
    pub enable_exchange: bool,
    pub enable_demag: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub external_field: Option<[f64; 3]>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub current_modules: Vec<CurrentModuleIR>,
    pub gyromagnetic_ratio: f64,
    pub precision: ExecutionPrecision,
    pub exchange_bc: ExchangeBoundaryCondition,
    pub integrator: IntegratorChoice,
    pub fixed_timestep: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub adaptive_timestep: Option<AdaptiveTimeStepIR>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub relaxation: Option<RelaxationControlIR>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub demag_realization: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub air_box_config: Option<AirBoxConfigIR>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub interfacial_dmi: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bulk_dmi: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dind_field: Option<Vec<f64>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dbulk_field: Option<Vec<f64>>,
    /// Temperature in Kelvin for thermal noise (0 = no thermal noise)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f64>,

    /// Global current density for Zhang-Li STT [A/m^2]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub current_density: Option<[f64; 3]>,
    /// Spin polarization degree for Zhang-Li STT (P)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stt_degree: Option<f64>,
    /// Non-adiabaticity parameter for Zhang-Li STT (beta)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stt_beta: Option<f64>,

    /// Fixed spin polarization vector for Slonczewski STT (p)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stt_spin_polarization: Option<[f64; 3]>,
    /// Slonczewski asymmetry parameter (Lambda)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stt_lambda: Option<f64>,
    /// Slonczewski secondary spin-transfer term (epsilon')
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stt_epsilon_prime: Option<f64>,

    /// Oersted field from cylindrical conductor
    #[serde(default)]
    pub has_oersted_cylinder: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub oersted_current: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub oersted_radius: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub oersted_center: Option<[f64; 3]>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub oersted_axis: Option<[f64; 3]>,
    #[serde(default)]
    pub oersted_time_dep_kind: u32,
    #[serde(default)]
    pub oersted_time_dep_freq: f64,
    #[serde(default)]
    pub oersted_time_dep_phase: f64,
    #[serde(default)]
    pub oersted_time_dep_offset: f64,
    #[serde(default)]
    pub oersted_time_dep_t_on: f64,
    #[serde(default)]
    pub oersted_time_dep_t_off: f64,

    /// Prescribed-strain magnetoelastic coupling
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub magnetoelastic: Option<FemMagnetoelasticPlanIR>,
}

/// Prescribed-strain magnetoelastic coupling plan for FEM backend.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FemMagnetoelasticPlanIR {
    /// First magnetoelastic coupling constant B₁ [Pa].
    pub b1: f64,
    /// Second magnetoelastic coupling constant B₂ [Pa].
    pub b2: f64,
    /// Prescribed strain in Voigt notation [ε₁₁, ε₂₂, ε₃₃, 2ε₂₃, 2ε₁₃, 2ε₁₂].
    /// If Some, treated as uniform strain across the entire body.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prescribed_strain: Option<[f64; 6]>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FemEigenPlanIR {
    pub mesh_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mesh_source: Option<String>,
    pub mesh: MeshIR,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub object_segments: Vec<FemObjectSegmentIR>,
    #[serde(default)]
    pub domain_mesh_mode: FemDomainMeshModeIR,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub domain_frame: Option<DomainFrameIR>,
    pub fe_order: u32,
    pub hmax: f64,
    pub equilibrium_magnetization: Vec<[f64; 3]>,
    pub material: MaterialIR,
    pub operator: EigenOperatorConfigIR,
    pub count: u32,
    pub target: EigenTargetIR,
    pub equilibrium: EquilibriumSourceIR,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub k_sampling: Option<KSamplingIR>,
    pub normalization: EigenNormalizationIR,
    pub damping_policy: EigenDampingPolicyIR,
    pub enable_exchange: bool,
    pub enable_demag: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub external_field: Option<[f64; 3]>,
    pub gyromagnetic_ratio: f64,
    pub precision: ExecutionPrecision,
    pub exchange_bc: ExchangeBoundaryCondition,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub demag_realization: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AirBoxConfigIR {
    pub factor: f64,
    pub grading: f64,
    pub boundary_marker: u32,
    /// Boundary condition kind: `"dirichlet"` or `"robin"`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bc_kind: Option<String>,
    /// Robin beta mode: `"legacy"` (c=1), `"dipole"` (c=2), `"user"`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub robin_beta_mode: Option<String>,
    /// User-specified c in β = c/R*.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub robin_beta_factor: Option<f64>,
    /// Airbox shape: `"bbox"` or `"sphere"`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shape: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RelaxationControlIR {
    pub algorithm: RelaxationAlgorithmIR,
    pub torque_tolerance: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub energy_tolerance: Option<f64>,
    pub max_steps: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct OutputPlanIR {
    pub outputs: Vec<OutputIR>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ProvenancePlanIR {
    pub notes: Vec<String>,
}

impl ProblemIR {
    pub fn bootstrap_example() -> Self {
        Self {
            ir_version: IR_VERSION.to_string(),
            problem_meta: ProblemMeta {
                name: "exchange_relax".to_string(),
                description: Some("Exchange-only relaxation bootstrap example.".to_string()),
                script_language: "python".to_string(),
                script_source: Some(
                    include_str!("../../../examples/exchange_relax.py").to_string(),
                ),
                script_api_version: IR_VERSION.to_string(),
                serializer_version: IR_VERSION.to_string(),
                entrypoint_kind: "build".to_string(),
                source_hash: None,
                runtime_metadata: BTreeMap::new(),
                backend_revision: None,
                seeds: Vec::new(),
            },
            geometry: GeometryIR {
                entries: vec![GeometryEntryIR::Box {
                    name: "strip".to_string(),
                    size: [200e-9, 20e-9, 6e-9],
                }],
            },
            geometry_assets: None,
            regions: vec![RegionIR {
                name: "strip".to_string(),
                geometry: "strip".to_string(),
            }],
            materials: vec![MaterialIR {
                name: "Py".to_string(),
                saturation_magnetisation: 800e3,
                exchange_stiffness: 13e-12,
                damping: 0.02,
                uniaxial_anisotropy: None,
                anisotropy_axis: None,
                uniaxial_anisotropy_k2: None,
                cubic_anisotropy_kc1: None,
                cubic_anisotropy_kc2: None,
                cubic_anisotropy_kc3: None,
                cubic_anisotropy_axis1: None,
                cubic_anisotropy_axis2: None,
                ms_field: None,
                a_field: None,
                alpha_field: None,
                ku_field: None,
                ku2_field: None,
                kc1_field: None,
                kc2_field: None,
                kc3_field: None,
            }],
            magnets: vec![MagnetIR {
                name: "strip".to_string(),
                region: "strip".to_string(),
                material: "Py".to_string(),
                initial_magnetization: Some(InitialMagnetizationIR::RandomSeeded { seed: 42 }),
            }],
            energy_terms: vec![EnergyTermIR::Exchange],
            study: StudyIR::TimeEvolution {
                dynamics: DynamicsIR::Llg {
                    gyromagnetic_ratio: 2.211e5,
                    integrator: "heun".to_string(),
                    fixed_timestep: Some(1e-13),
                    adaptive_timestep: None,
                    mechanics: None,
                },
                sampling: SamplingIR {
                    outputs: vec![
                        OutputIR::Field {
                            name: "m".to_string(),
                            every_seconds: 1e-12,
                        },
                        OutputIR::Field {
                            name: "H_ex".to_string(),
                            every_seconds: 1e-12,
                        },
                        OutputIR::Scalar {
                            name: "E_ex".to_string(),
                            every_seconds: 1e-12,
                        },
                    ],
                },
            },
            backend_policy: BackendPolicyIR {
                requested_backend: BackendTarget::Fdm,
                execution_precision: ExecutionPrecision::Double,
                discretization_hints: Some(DiscretizationHintsIR {
                    fdm: Some(FdmHintsIR {
                        cell: [2e-9, 2e-9, 2e-9],
                        default_cell: None,
                        per_magnet: None,
                        demag: None,
                        boundary_correction: None,
                    }),
                    fem: Some(FemHintsIR {
                        order: 1,
                        hmax: 2e-9,
                        mesh: None,
                    }),
                    hybrid: None,
                }),
            },
            validation_profile: ValidationProfileIR {
                execution_mode: ExecutionMode::Strict,
            },
            current_modules: Vec::new(),
            excitation_analysis: None,
            current_density: None,
            stt_degree: None,
            stt_beta: None,
            stt_spin_polarization: None,
            stt_lambda: None,
            stt_epsilon_prime: None,
            temperature: None,
            elastic_materials: vec![],
            elastic_bodies: vec![],
            magnetostriction_laws: vec![],
            mechanical_bcs: vec![],
            mechanical_loads: vec![],
        }
    }

    pub fn validate(&self) -> Result<(), Vec<String>> {
        let mut errors = Vec::new();

        if self.ir_version.trim().is_empty() {
            errors.push("ir_version must not be empty".to_string());
        }
        if self.problem_meta.name.trim().is_empty() {
            errors.push("problem_meta.name must not be empty".to_string());
        }
        if self.problem_meta.script_language != "python" {
            errors.push("problem_meta.script_language must be 'python'".to_string());
        }
        if self.problem_meta.script_api_version.trim().is_empty() {
            errors.push("problem_meta.script_api_version must not be empty".to_string());
        }
        if self.problem_meta.serializer_version.trim().is_empty() {
            errors.push("problem_meta.serializer_version must not be empty".to_string());
        }
        if self.problem_meta.entrypoint_kind.trim().is_empty() {
            errors.push("problem_meta.entrypoint_kind must not be empty".to_string());
        }
        if self.geometry.entries.is_empty() {
            errors.push("at least one geometry entry is required".to_string());
        }
        if let Some(geometry_assets) = &self.geometry_assets {
            if let Err(asset_errors) = geometry_assets.validate() {
                errors.extend(asset_errors);
            }
        }
        if self.regions.is_empty() {
            errors.push("at least one region is required".to_string());
        }
        if self.materials.is_empty() {
            errors.push("at least one material is required".to_string());
        }
        if self.magnets.is_empty() {
            errors.push("at least one magnet is required".to_string());
        }
        if self.energy_terms.is_empty() {
            errors.push("at least one energy term is required".to_string());
        }
        if self.study.sampling().outputs.is_empty() {
            errors.push("at least one output is required".to_string());
        }
        for output in &self.study.sampling().outputs {
            match output {
                OutputIR::Field {
                    name,
                    every_seconds,
                } => {
                    if name.trim().is_empty() {
                        errors.push("field output name must not be empty".to_string());
                    }
                    if *every_seconds <= 0.0 {
                        errors.push(format!(
                            "field output '{}' must have positive every_seconds",
                            name
                        ));
                    }
                }
                OutputIR::Scalar {
                    name,
                    every_seconds,
                } => {
                    if name.trim().is_empty() {
                        errors.push("scalar output name must not be empty".to_string());
                    }
                    if *every_seconds <= 0.0 {
                        errors.push(format!(
                            "scalar output '{}' must have positive every_seconds",
                            name
                        ));
                    }
                }
                OutputIR::Snapshot {
                    field,
                    component,
                    every_seconds,
                    ..
                } => {
                    if field.trim().is_empty() {
                        errors.push("snapshot field name must not be empty".to_string());
                    }
                    let valid_components = ["x", "y", "z", "3D"];
                    if !valid_components.contains(&component.as_str()) {
                        errors.push(format!(
                            "snapshot component '{}' must be one of: x, y, z, 3D",
                            component
                        ));
                    }
                    if *every_seconds <= 0.0 {
                        errors.push(format!(
                            "snapshot '{}' must have positive every_seconds",
                            field
                        ));
                    }
                }
                OutputIR::EigenSpectrum { quantity } => {
                    if quantity.trim().is_empty() {
                        errors.push("eigen_spectrum quantity must not be empty".to_string());
                    }
                }
                OutputIR::EigenMode { field, indices } => {
                    if field.trim().is_empty() {
                        errors.push("eigen_mode field must not be empty".to_string());
                    }
                    if indices.is_empty() {
                        errors.push("eigen_mode must contain at least one mode index".to_string());
                    }
                }
                OutputIR::DispersionCurve { name } => {
                    if name.trim().is_empty() {
                        errors.push("dispersion_curve name must not be empty".to_string());
                    }
                }
            }
        }
        match &self.study {
            StudyIR::TimeEvolution { dynamics, .. } => {
                validate_study_dynamics(dynamics, &mut errors);
                for output in &self.study.sampling().outputs {
                    if matches!(
                        output,
                        OutputIR::EigenSpectrum { .. }
                            | OutputIR::EigenMode { .. }
                            | OutputIR::DispersionCurve { .. }
                    ) {
                        errors.push(
                            "time_evolution outputs must be field/scalar/snapshot requests"
                                .to_string(),
                        );
                    }
                }
            }
            StudyIR::Relaxation {
                dynamics,
                torque_tolerance,
                energy_tolerance,
                max_steps,
                ..
            } => {
                validate_study_dynamics(dynamics, &mut errors);
                if *torque_tolerance <= 0.0 {
                    errors.push("relaxation.torque_tolerance must be positive".to_string());
                }
                if energy_tolerance.is_some_and(|value| value <= 0.0) {
                    errors.push(
                        "relaxation.energy_tolerance must be positive when provided".to_string(),
                    );
                }
                if *max_steps == 0 {
                    errors.push("relaxation.max_steps must be > 0".to_string());
                }
                for output in &self.study.sampling().outputs {
                    if matches!(
                        output,
                        OutputIR::EigenSpectrum { .. }
                            | OutputIR::EigenMode { .. }
                            | OutputIR::DispersionCurve { .. }
                    ) {
                        errors.push(
                            "relaxation outputs must be field/scalar/snapshot requests".to_string(),
                        );
                    }
                }
            }
            StudyIR::Eigenmodes {
                dynamics,
                operator,
                count,
                target,
                equilibrium,
                k_sampling,
                ..
            } => {
                validate_study_dynamics(dynamics, &mut errors);
                if *count == 0 {
                    errors.push("eigenmodes.count must be > 0".to_string());
                }
                match operator.kind {
                    EigenOperatorIR::LinearizedLlg => {}
                }
                match target {
                    EigenTargetIR::Lowest => {}
                    EigenTargetIR::Nearest { frequency_hz } => {
                        if *frequency_hz <= 0.0 {
                            errors.push(
                                "eigenmodes.target.frequency_hz must be positive".to_string(),
                            );
                        }
                    }
                }
                if let EquilibriumSourceIR::Artifact { path } = equilibrium {
                    if path.trim().is_empty() {
                        errors.push(
                            "eigenmodes.equilibrium artifact path must not be empty".to_string(),
                        );
                    }
                }
                if let Some(KSamplingIR::Single { k_vector }) = k_sampling {
                    if !k_vector.iter().all(|value| value.is_finite()) {
                        errors.push(
                            "eigenmodes.k_sampling.k_vector must contain finite values".to_string(),
                        );
                    }
                }
                let has_mode_output = self
                    .study
                    .sampling()
                    .outputs
                    .iter()
                    .any(|output| matches!(output, OutputIR::EigenMode { .. }));
                let has_spectrum_output = self
                    .study
                    .sampling()
                    .outputs
                    .iter()
                    .any(|output| matches!(output, OutputIR::EigenSpectrum { .. }));
                if !has_mode_output && !has_spectrum_output {
                    errors.push(
                        "eigenmodes study requires at least one eigen_spectrum or eigen_mode output"
                            .to_string(),
                    );
                }
                for output in &self.study.sampling().outputs {
                    if matches!(
                        output,
                        OutputIR::Field { .. }
                            | OutputIR::Scalar { .. }
                            | OutputIR::Snapshot { .. }
                    ) {
                        errors.push(
                            "eigenmodes outputs must be eigen_spectrum/eigen_mode/dispersion_curve requests"
                                .to_string(),
                        );
                    }
                }
            }
        }

        for magnet in &self.magnets {
            if let Some(ref init_mag) = magnet.initial_magnetization {
                match init_mag {
                    InitialMagnetizationIR::Uniform { value } => {
                        let norm =
                            (value[0] * value[0] + value[1] * value[1] + value[2] * value[2])
                                .sqrt();
                        if norm <= 0.0 {
                            errors.push(format!(
                                "magnet '{}': uniform initial magnetization must be non-zero",
                                magnet.name
                            ));
                        }
                    }
                    InitialMagnetizationIR::RandomSeeded { seed } => {
                        if *seed == 0 {
                            errors.push(format!(
                                "magnet '{}': random_seeded seed must be > 0",
                                magnet.name
                            ));
                        }
                    }
                    InitialMagnetizationIR::SampledField { values } => {
                        if values.is_empty() {
                            errors.push(format!(
                                "magnet '{}': sampled_field values must not be empty",
                                magnet.name
                            ));
                        }
                    }
                }
            }
        }

        validate_unique_names(
            self.geometry.entries.iter().map(GeometryEntryIR::name),
            "geometry entries",
            &mut errors,
        );
        validate_unique_names(
            self.regions.iter().map(|region| region.name.as_str()),
            "regions",
            &mut errors,
        );
        validate_unique_names(
            self.materials.iter().map(|material| material.name.as_str()),
            "materials",
            &mut errors,
        );
        validate_unique_names(
            self.magnets.iter().map(|magnet| magnet.name.as_str()),
            "magnets",
            &mut errors,
        );
        validate_unique_names(
            self.current_modules.iter().map(|module| match module {
                CurrentModuleIR::AntennaFieldSource { name, .. } => name.as_str(),
            }),
            "current modules",
            &mut errors,
        );

        if let Some(analysis) = self.excitation_analysis.as_ref() {
            let source_exists = self.current_modules.iter().any(|module| match module {
                CurrentModuleIR::AntennaFieldSource { name, .. } => name == &analysis.source,
            });
            if !source_exists {
                errors.push(format!(
                    "excitation_analysis.source '{}' must reference one of current_modules",
                    analysis.source
                ));
            }
            if analysis.method.trim().is_empty() {
                errors.push("excitation_analysis.method must not be empty".to_string());
            }
            if analysis.samples < 2 {
                errors.push("excitation_analysis.samples must be >= 2".to_string());
            }
        }

        for geometry in &self.geometry.entries {
            match geometry {
                GeometryEntryIR::ImportedGeometry {
                    name,
                    source,
                    format,
                    scale,
                } => {
                    if name.trim().is_empty() {
                        errors.push("imported geometry name must not be empty".to_string());
                    }
                    if source.trim().is_empty() {
                        errors.push(format!("geometry '{}' source must not be empty", name));
                    }
                    if !scale.is_positive() {
                        errors.push(format!("geometry '{}' scale must be positive", name));
                    }
                    if format.trim().is_empty() {
                        errors.push(format!("geometry '{}' format must not be empty", name));
                    }
                }
                GeometryEntryIR::Box { name, size } => {
                    if name.trim().is_empty() {
                        errors.push("box geometry name must not be empty".to_string());
                    }
                    if size.iter().any(|component| *component <= 0.0) {
                        errors.push(format!(
                            "box geometry '{}' size components must be positive",
                            name
                        ));
                    }
                }
                GeometryEntryIR::Cylinder {
                    name,
                    radius,
                    height,
                } => {
                    if name.trim().is_empty() {
                        errors.push("cylinder geometry name must not be empty".to_string());
                    }
                    if *radius <= 0.0 {
                        errors.push(format!(
                            "cylinder geometry '{}' radius must be positive",
                            name
                        ));
                    }
                    if *height <= 0.0 {
                        errors.push(format!(
                            "cylinder geometry '{}' height must be positive",
                            name
                        ));
                    }
                }
                GeometryEntryIR::Difference { name, base, tool } => {
                    if name.trim().is_empty() {
                        errors.push("difference geometry name must not be empty".to_string());
                    }
                    let _ = (base, tool);
                }
                // CSG compounds and transforms: validate name only
                GeometryEntryIR::Ellipsoid { name, .. }
                | GeometryEntryIR::Sphere { name, .. }
                | GeometryEntryIR::Ellipse { name, .. }
                | GeometryEntryIR::Union { name, .. }
                | GeometryEntryIR::Intersection { name, .. }
                | GeometryEntryIR::Translate { name, .. } => {
                    if name.trim().is_empty() {
                        errors.push("geometry name must not be empty".to_string());
                    }
                }
            }
        }

        let geometry_names: BTreeSet<&str> = self
            .geometry
            .entries
            .iter()
            .map(GeometryEntryIR::name)
            .collect();
        let region_names: BTreeSet<&str> = self
            .regions
            .iter()
            .map(|region| region.name.as_str())
            .collect();
        let material_names: BTreeSet<&str> = self
            .materials
            .iter()
            .map(|material| material.name.as_str())
            .collect();

        for region in &self.regions {
            if !geometry_names.contains(region.geometry.as_str()) {
                errors.push(format!(
                    "region '{}' references missing geometry '{}'",
                    region.name, region.geometry
                ));
            }
        }

        for magnet in &self.magnets {
            if !region_names.contains(magnet.region.as_str()) {
                errors.push(format!(
                    "magnet '{}' references missing region '{}'",
                    magnet.name, magnet.region
                ));
            }
            if !material_names.contains(magnet.material.as_str()) {
                errors.push(format!(
                    "magnet '{}' references missing material '{}'",
                    magnet.name, magnet.material
                ));
            }
            if let Some(initial_magnetization) = &magnet.initial_magnetization {
                match initial_magnetization {
                    InitialMagnetizationIR::Uniform { .. } => {}
                    InitialMagnetizationIR::RandomSeeded { seed } => {
                        if *seed == 0 {
                            errors.push(format!(
                                "magnet '{}' random_seeded seed must be positive",
                                magnet.name
                            ));
                        }
                    }
                    InitialMagnetizationIR::SampledField { values } => {
                        if values.is_empty() {
                            errors.push(format!(
                                "magnet '{}' sampled_field values must not be empty",
                                magnet.name
                            ));
                        }
                    }
                }
            }
        }

        match (
            self.backend_policy.requested_backend,
            self.validation_profile.execution_mode,
        ) {
            (BackendTarget::Hybrid, mode) if mode != ExecutionMode::Hybrid => errors
                .push("requested_backend='hybrid' requires execution_mode='hybrid'".to_string()),
            (backend, ExecutionMode::Hybrid) if backend != BackendTarget::Hybrid => errors
                .push("execution_mode='hybrid' requires requested_backend='hybrid'".to_string()),
            _ => {}
        }

        if let Some(hints) = &self.backend_policy.discretization_hints {
            if let Some(fdm) = &hints.fdm {
                if fdm.cell.iter().any(|component| *component <= 0.0) {
                    errors.push("fdm.cell components must be positive".to_string());
                }
            }
            if let Some(fem) = &hints.fem {
                if fem.order == 0 {
                    errors.push("fem.order must be >= 1".to_string());
                }
                if fem.hmax <= 0.0 {
                    errors.push("fem.hmax must be positive".to_string());
                }
                if fem.mesh.as_ref().is_some_and(|mesh| mesh.trim().is_empty()) {
                    errors.push("fem.mesh must not be empty when provided".to_string());
                }
            }
            if let Some(hybrid) = &hints.hybrid {
                if hybrid.demag.trim().is_empty() {
                    errors.push("hybrid.demag must not be empty".to_string());
                }
            }
        }

        if errors.is_empty() {
            Ok(())
        } else {
            Err(errors)
        }
    }

    pub fn plan_for(
        &self,
        backend_override: Option<BackendTarget>,
    ) -> Result<ExecutionPlanSummary, Vec<String>> {
        self.validate()?;

        let requested_backend = backend_override.unwrap_or(self.backend_policy.requested_backend);
        let execution_mode = self.validation_profile.execution_mode;

        let mut errors = Vec::new();
        match (requested_backend, execution_mode) {
            (BackendTarget::Hybrid, mode) if mode != ExecutionMode::Hybrid => errors
                .push("planning backend 'hybrid' requires execution_mode='hybrid'".to_string()),
            (backend, ExecutionMode::Hybrid) if backend != BackendTarget::Hybrid => errors
                .push("execution_mode='hybrid' can only plan the 'hybrid' backend".to_string()),
            _ => {}
        }
        if !errors.is_empty() {
            return Err(errors);
        }

        let resolved_backend = match requested_backend {
            BackendTarget::Auto => match execution_mode {
                ExecutionMode::Hybrid => BackendTarget::Hybrid,
                ExecutionMode::Strict | ExecutionMode::Extended => BackendTarget::Fdm,
            },
            backend => backend,
        };

        let mut notes = vec![format!(
            "{} energy terms mapped into planning-only execution.",
            self.energy_terms.len()
        )];
        if requested_backend == BackendTarget::Auto {
            notes.push(format!(
                "requested_backend='auto' resolves to '{}' during bootstrap planning",
                resolved_backend.as_str()
            ));
        }

        Ok(ExecutionPlanSummary {
            requested_backend,
            resolved_backend,
            execution_mode,
            notes,
        })
    }
}

impl BackendTarget {
    pub fn as_str(self) -> &'static str {
        match self {
            BackendTarget::Auto => "auto",
            BackendTarget::Fdm => "fdm",
            BackendTarget::Fem => "fem",
            BackendTarget::Hybrid => "hybrid",
        }
    }
}

impl RelaxationAlgorithmIR {
    pub fn as_str(self) -> &'static str {
        match self {
            RelaxationAlgorithmIR::LlgOverdamped => "llg_overdamped",
            RelaxationAlgorithmIR::ProjectedGradientBb => "projected_gradient_bb",
            RelaxationAlgorithmIR::NonlinearCg => "nonlinear_cg",
            RelaxationAlgorithmIR::TangentPlaneImplicit => "tangent_plane_implicit",
        }
    }

    /// Physics-optimal default integrator for each relaxation algorithm.
    ///
    /// - `LlgOverdamped` / `ProjectedGradientBb` / `NonlinearCg` → RK23
    ///   (mumax3 Relax pattern: cheap 3rd-order adaptive, fast overdamped convergence)
    /// - `TangentPlaneImplicit` → Heun (FEM implicit; Heun for explicit sub-steps)
    pub fn default_integrator(self) -> IntegratorChoice {
        match self {
            Self::LlgOverdamped | Self::ProjectedGradientBb | Self::NonlinearCg => {
                IntegratorChoice::Rk23
            }
            Self::TangentPlaneImplicit => IntegratorChoice::Heun,
        }
    }
}

fn default_axis_z() -> [f64; 3] {
    [0.0, 0.0, 1.0]
}

fn default_current_distribution_uniform() -> String {
    "uniform".to_string()
}

fn default_antenna_air_box_factor() -> f64 {
    12.0
}

fn validate_unique_names<'a>(
    names: impl Iterator<Item = &'a str>,
    label: &str,
    errors: &mut Vec<String>,
) {
    let mut seen = BTreeSet::new();
    let mut duplicates = BTreeSet::new();
    for name in names {
        if !seen.insert(name) {
            duplicates.insert(name.to_string());
        }
    }
    if !duplicates.is_empty() {
        errors.push(format!(
            "{} must have unique names: {}",
            label,
            duplicates.into_iter().collect::<Vec<_>>().join(", ")
        ));
    }
}

fn is_supported_llg_integrator(integrator: &str) -> bool {
    matches!(
        integrator,
        "heun" | "rk4" | "rk23" | "rk45" | "abm3" | "auto"
    )
}

fn validate_study_dynamics(dynamics: &DynamicsIR, errors: &mut Vec<String>) {
    match dynamics {
        DynamicsIR::Llg {
            gyromagnetic_ratio,
            integrator,
            fixed_timestep,
            ..
        } => {
            if *gyromagnetic_ratio <= 0.0 {
                errors.push("llg.gyromagnetic_ratio must be positive".to_string());
            }
            if integrator.trim().is_empty() {
                errors.push("llg.integrator must not be empty".to_string());
            } else if !is_supported_llg_integrator(integrator.as_str()) {
                errors.push(
                    "llg.integrator must be one of: heun, rk4, rk23, rk45, abm3, auto".to_string(),
                );
            }
            if fixed_timestep.is_some_and(|value| value <= 0.0) {
                errors.push("llg.fixed_timestep must be positive when provided".to_string());
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bootstrap_example_round_trips_as_json() {
        let ir = ProblemIR::bootstrap_example();
        let json = serde_json::to_string_pretty(&ir).expect("bootstrap example should serialize");
        let decoded: ProblemIR =
            serde_json::from_str(&json).expect("bootstrap example should deserialize");
        assert_eq!(decoded.problem_meta.script_language, "python");
        assert_eq!(decoded.ir_version, IR_VERSION);
        assert_eq!(
            decoded.validation_profile.execution_mode,
            ExecutionMode::Strict
        );
        // Verify Box geometry round-trips
        match &decoded.geometry.entries[0] {
            GeometryEntryIR::Box { name, size } => {
                assert_eq!(name, "strip");
                assert_eq!(size, &[200e-9, 20e-9, 6e-9]);
            }
            other => panic!("expected Box geometry, got {:?}", other),
        }
        // Verify RandomSeeded m0 round-trips
        match &decoded.magnets[0].initial_magnetization {
            Some(InitialMagnetizationIR::RandomSeeded { seed }) => {
                assert_eq!(*seed, 42);
            }
            other => panic!("expected RandomSeeded m0, got {:?}", other),
        }
    }

    #[test]
    fn bootstrap_example_validates() {
        let ir = ProblemIR::bootstrap_example();
        assert!(ir.validate().is_ok());
    }

    #[test]
    fn hybrid_mode_requires_hybrid_backend() {
        let mut ir = ProblemIR::bootstrap_example();
        ir.validation_profile.execution_mode = ExecutionMode::Hybrid;

        let errors = ir
            .validate()
            .expect_err("hybrid mode without hybrid backend must fail");
        assert!(errors
            .iter()
            .any(|error| error
                .contains("execution_mode='hybrid' requires requested_backend='hybrid'")));
    }

    #[test]
    fn planning_with_backend_override_produces_summary() {
        let ir = ProblemIR::bootstrap_example();

        let plan = ir
            .plan_for(Some(BackendTarget::Fem))
            .expect("planning for FEM should succeed");

        assert_eq!(plan.requested_backend, BackendTarget::Fem);
        assert_eq!(plan.resolved_backend, BackendTarget::Fem);
        assert_eq!(plan.execution_mode, ExecutionMode::Strict);
    }

    #[test]
    fn llg_requires_supported_integrator() {
        let mut ir = ProblemIR::bootstrap_example();
        ir.study = StudyIR::TimeEvolution {
            dynamics: DynamicsIR::Llg {
                gyromagnetic_ratio: 2.211e5,
                integrator: "bogus".to_string(),
                fixed_timestep: None,
                adaptive_timestep: None,
                mechanics: None,
            },
            sampling: ir.study.sampling().clone(),
        };

        let errors = ir
            .validate()
            .expect_err("unsupported llg integrator must fail validation");
        assert!(errors
            .iter()
            .any(|error| error.contains("llg.integrator must be one of")));
    }

    #[test]
    fn random_seeded_initial_magnetization_must_be_positive() {
        let mut ir = ProblemIR::bootstrap_example();
        ir.magnets[0].initial_magnetization =
            Some(InitialMagnetizationIR::RandomSeeded { seed: 0 });

        let errors = ir
            .validate()
            .expect_err("zero random seed must fail validation");
        assert!(errors
            .iter()
            .any(|error| error.contains("random_seeded seed must be positive")));
    }

    #[test]
    fn sampled_field_initial_magnetization_must_not_be_empty() {
        let mut ir = ProblemIR::bootstrap_example();
        ir.magnets[0].initial_magnetization =
            Some(InitialMagnetizationIR::SampledField { values: vec![] });

        let errors = ir
            .validate()
            .expect_err("empty sampled field must fail validation");
        assert!(errors
            .iter()
            .any(|error| error.contains("sampled_field values must not be empty")));
    }

    #[test]
    fn analytic_geometry_must_have_positive_dimensions() {
        let mut ir = ProblemIR::bootstrap_example();
        ir.geometry.entries[0] = GeometryEntryIR::Cylinder {
            name: "strip".to_string(),
            radius: -1.0,
            height: 5e-9,
        };

        let errors = ir
            .validate()
            .expect_err("negative cylinder radius must fail validation");
        assert!(errors
            .iter()
            .any(|error| error.contains("cylinder geometry 'strip' radius must be positive")));
    }

    #[test]
    fn execution_plan_ir_serializes() {
        let plan = ExecutionPlanIR {
            common: CommonPlanMeta {
                ir_version: IR_VERSION.to_string(),
                requested_backend: BackendTarget::Auto,
                resolved_backend: BackendTarget::Fdm,
                execution_mode: ExecutionMode::Strict,
            },
            backend_plan: BackendPlanIR::Fdm(FdmPlanIR {
                grid: GridDimensions {
                    cells: [100, 10, 3],
                },
                cell_size: [2e-9, 2e-9, 2e-9],
                region_mask: vec![0, 0, 1],
                active_mask: None,
                initial_magnetization: vec![[1.0, 0.0, 0.0]],
                material: FdmMaterialIR {
                    name: "Py".to_string(),
                    saturation_magnetisation: 800e3,
                    exchange_stiffness: 13e-12,
                    damping: 0.02,
                },
                enable_exchange: true,
                enable_demag: false,
                external_field: None,
                gyromagnetic_ratio: 2.211e5,
                precision: ExecutionPrecision::Double,
                exchange_bc: ExchangeBoundaryCondition::Neumann,
                integrator: IntegratorChoice::Heun,
                fixed_timestep: Some(1e-13),
                adaptive_timestep: None,
                relaxation: None,
                boundary_correction: None,
                boundary_geometry: None,
                inter_region_exchange: vec![],
                current_density: None,
                stt_degree: None,
                stt_beta: None,
                stt_spin_polarization: None,
                stt_lambda: None,
                stt_epsilon_prime: None,
                has_oersted_cylinder: false,
                oersted_current: None,
                oersted_radius: None,
                oersted_center: None,
                oersted_axis: None,
                oersted_time_dep_kind: 0,
                oersted_time_dep_freq: 0.0,
                oersted_time_dep_phase: 0.0,
                oersted_time_dep_offset: 0.0,
                oersted_time_dep_t_on: 0.0,
                oersted_time_dep_t_off: 0.0,
                temperature: None,
            }),
            output_plan: OutputPlanIR {
                outputs: vec![OutputIR::Field {
                    name: "m".to_string(),
                    every_seconds: 1e-12,
                }],
            },
            provenance: ProvenancePlanIR {
                notes: vec!["planner stub".to_string()],
            },
        };

        let encoded = serde_json::to_string(&plan).expect("execution plan should serialize");
        let decoded: ExecutionPlanIR =
            serde_json::from_str(&encoded).expect("execution plan should deserialize");
        assert_eq!(decoded, plan);
    }

    #[test]
    fn fdm_grid_asset_must_not_be_empty() {
        let asset = FdmGridAssetIR {
            geometry_name: "mesh".to_string(),
            cells: [2, 2, 1],
            cell_size: [5e-9, 5e-9, 5e-9],
            origin: [0.0, 0.0, 0.0],
            active_mask: vec![false, false, false, false],
        };

        let errors = asset
            .validate()
            .expect_err("empty active mask must fail validation");
        assert!(errors
            .iter()
            .any(|error| error.contains("must contain at least one active cell")));
    }

    #[test]
    fn eigenmodes_with_spectrum_and_mode_outputs_validate() {
        let mut ir = ProblemIR::bootstrap_example();
        let dynamics = ir.study.dynamics().clone();
        ir.study = StudyIR::Eigenmodes {
            dynamics,
            operator: EigenOperatorConfigIR {
                kind: EigenOperatorIR::LinearizedLlg,
                include_demag: false,
            },
            count: 6,
            target: EigenTargetIR::Lowest,
            equilibrium: EquilibriumSourceIR::Provided,
            k_sampling: Some(KSamplingIR::Single {
                k_vector: [0.0, 0.0, 0.0],
            }),
            normalization: EigenNormalizationIR::UnitL2,
            damping_policy: EigenDampingPolicyIR::Ignore,
            sampling: SamplingIR {
                outputs: vec![
                    OutputIR::EigenSpectrum {
                        quantity: "eigenfrequency".to_string(),
                    },
                    OutputIR::EigenMode {
                        field: "mode".to_string(),
                        indices: vec![0, 1],
                    },
                ],
            },
        };

        assert!(ir.validate().is_ok());
    }

    #[test]
    fn eigenmodes_require_spectrum_or_mode_output() {
        let mut ir = ProblemIR::bootstrap_example();
        let dynamics = ir.study.dynamics().clone();
        ir.study = StudyIR::Eigenmodes {
            dynamics,
            operator: EigenOperatorConfigIR {
                kind: EigenOperatorIR::LinearizedLlg,
                include_demag: false,
            },
            count: 4,
            target: EigenTargetIR::Lowest,
            equilibrium: EquilibriumSourceIR::Provided,
            k_sampling: None,
            normalization: EigenNormalizationIR::UnitL2,
            damping_policy: EigenDampingPolicyIR::Ignore,
            sampling: SamplingIR {
                outputs: vec![OutputIR::DispersionCurve {
                    name: "dispersion".to_string(),
                }],
            },
        };

        let errors = ir
            .validate()
            .expect_err("dispersion-only eigen study must fail validation");
        assert!(errors.iter().any(|error| {
            error.contains(
                "eigenmodes study requires at least one eigen_spectrum or eigen_mode output",
            )
        }));
    }
}
