"use client";

export interface EigenModeSummary {
  index: number;
  frequency_hz: number;
  angular_frequency_rad_per_s: number;
  eigenvalue_field_au_per_m: number;
  norm: number;
  max_amplitude: number;
  dominant_polarization: string;
  k_vector: [number, number, number] | null;
}

export interface EigenSpectrumArtifact {
  study_kind: string;
  mesh_name: string | null;
  mode_count: number;
  normalization: string;
  damping_policy: string;
  equilibrium_source: {
    kind: string;
    path?: string;
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
  angular_frequency_rad_per_s: number;
  normalization: string;
  damping_policy: string;
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
  boundary_faces: [number, number, number][];
}
