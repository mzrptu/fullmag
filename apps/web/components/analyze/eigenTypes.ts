"use client";

export interface EigenModeSummary {
  index: number;
  frequency_hz: number;
  frequency_real_hz?: number;
  frequency_imag_hz?: number;
  angular_frequency_rad_per_s: number;
  eigenvalue_field_au_per_m: number;
  eigenvalue_real?: number;
  eigenvalue_imag?: number;
  norm: number;
  max_amplitude: number;
  dominant_polarization: string;
  k_vector: [number, number, number] | null;
}

export interface SpinWaveBoundaryConfig {
  kind: string;
  boundary_pair_id?: string | null;
  surface_anisotropy_ks?: number | null;
  surface_anisotropy_axis?: [number, number, number] | null;
}

export interface EigenSpectrumArtifact {
  study_kind: string;
  solver_backend?: string;
  solver_kind?: string;
  solver_notes?: string;
  solver_capabilities?: string[];
  solver_limitations?: string[];
  mesh_name: string | null;
  mode_count: number;
  normalization: string;
  damping_policy: string;
  spin_wave_bc?: string;
  boundary_config?: SpinWaveBoundaryConfig;
  equilibrium_source: {
    kind: string;
    path?: string;
  };
  included_terms?: {
    exchange?: boolean;
    demag?: boolean;
    zeeman?: boolean;
    interfacial_dmi?: boolean;
    bulk_dmi?: boolean;
    surface_anisotropy?: boolean;
  };
  operator: {
    kind: string;
    include_demag: boolean;
  };
  k_sampling: [number, number, number] | null;
  relaxation_steps: number;
  modes: EigenModeSummary[];
}

export interface EigenModeArtifact {
  index: number;
  frequency_hz: number;
  frequency_real_hz?: number;
  frequency_imag_hz?: number;
  angular_frequency_rad_per_s: number;
  eigenvalue_real?: number;
  eigenvalue_imag?: number;
  normalization: string;
  damping_policy: string;
  solver_backend?: string;
  solver_kind?: string;
  solver_notes?: string;
  solver_capabilities?: string[];
  solver_limitations?: string[];
  dominant_polarization: string;
  k_vector: [number, number, number] | null;
  real: [number, number, number][];
  imag: [number, number, number][];
  amplitude: number[];
  phase: number[];
}

export interface DispersionRow {
  modeIndex: number;
  kx: number;
  ky: number;
  kz: number;
  frequencyHz: number;
  angularFrequencyRadPerS: number;
}

export interface FemMeshPayload {
  nodes: [number, number, number][];
  elements: [number, number, number, number][];
  element_markers?: number[];
  boundary_faces: [number, number, number][];
  boundary_markers?: number[];
  object_segments?: {
    object_id: string;
    geometry_id?: string | null;
    node_start: number;
    node_count: number;
    element_start: number;
    element_count: number;
    boundary_face_start: number;
    boundary_face_count: number;
  }[];
}
