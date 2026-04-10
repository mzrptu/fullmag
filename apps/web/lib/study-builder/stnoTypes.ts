/**
 * STNO authoring types — state models for spin-torque, Oersted field, thermal
 * noise, and waveform modulation used in the study builder / Drive panel.
 *
 * These types describe the _UI state_ that maps to the Python DSL classes:
 *   SttState         → SlonczewskiSTT / ZhangLiSTT
 *   OerstedState     → OerstedCylinder
 *   ThermalState     → ThermalNoise / Problem.temperature
 *   WaveformState    → Constant / Sinusoidal / Pulse / PiecewiseLinear
 */

// ── STT model selection ───────────────────────────────────────

export type SttModel = "slonczewski" | "zhang_li" | "none";

export interface SlonczewskiParams {
  currentDensity: [number, number, number]; // A/m²
  spinPolarization: [number, number, number]; // unit vector
  degree: number; // P ∈ (0, 1]
  lambdaAsymmetry: number; // Λ ≥ 1
  epsilonPrime: number; // ε' ≥ 0
}

export interface ZhangLiParams {
  currentDensity: [number, number, number]; // A/m²
  degree: number; // P ∈ (0, 1]
  beta: number; // non-adiabaticity
}

export interface SttState {
  model: SttModel;
  slonczewski: SlonczewskiParams;
  zhangLi: ZhangLiParams;
}

export const DEFAULT_SLONCZEWSKI: SlonczewskiParams = {
  currentDensity: [0, 0, 5e10],
  spinPolarization: [0, 0, 1],
  degree: 0.4,
  lambdaAsymmetry: 1.0,
  epsilonPrime: 0.0,
};

export const DEFAULT_ZHANG_LI: ZhangLiParams = {
  currentDensity: [1e11, 0, 0],
  degree: 0.4,
  beta: 0.0,
};

export const DEFAULT_STT_STATE: SttState = {
  model: "none",
  slonczewski: DEFAULT_SLONCZEWSKI,
  zhangLi: DEFAULT_ZHANG_LI,
};

// ── Waveform / time-dependence envelopes ──────────────────────

export type WaveformKind =
  | "constant"
  | "sinusoidal"
  | "pulse"
  | "piecewise_linear";

export interface SinusoidalParams {
  frequencyHz: number;
  phaseRad: number;
  offset: number;
}

export interface PulseParams {
  tOn: number; // [s]
  tOff: number; // [s]
}

export interface PiecewiseLinearPoint {
  time: number; // [s]
  value: number; // dimensionless multiplier
}

export interface WaveformState {
  kind: WaveformKind;
  sinusoidal: SinusoidalParams;
  pulse: PulseParams;
  piecewiseLinearPoints: PiecewiseLinearPoint[];
}

export const DEFAULT_WAVEFORM: WaveformState = {
  kind: "constant",
  sinusoidal: { frequencyHz: 1e9, phaseRad: 0, offset: 0 },
  pulse: { tOn: 0, tOff: 10e-9 },
  piecewiseLinearPoints: [
    { time: 0, value: 0 },
    { time: 10e-9, value: 1 },
  ],
};

// ── Oersted field ─────────────────────────────────────────────

export interface OerstedState {
  enabled: boolean;
  current: number; // DC current [A]
  radius: number; // pillar radius [m]
  center: [number, number, number]; // [m]
  axis: [number, number, number]; // unit vector
  waveform: WaveformState;
}

export const DEFAULT_OERSTED: OerstedState = {
  enabled: false,
  current: 5e-3,
  radius: 50e-9,
  center: [0, 0, 0],
  axis: [0, 0, 1],
  waveform: DEFAULT_WAVEFORM,
};

// ── Thermal noise ─────────────────────────────────────────────

export interface ThermalState {
  enabled: boolean;
  temperature: number; // [K]
  seed: number | null; // RNG seed (null → random)
}

export const DEFAULT_THERMAL: ThermalState = {
  enabled: false,
  temperature: 300,
  seed: null,
};

// ── Aggregate STNO drive state ────────────────────────────────

export interface StnoDriveState {
  stt: SttState;
  oersted: OerstedState;
  thermal: ThermalState;
}

export const DEFAULT_STNO_DRIVE: StnoDriveState = {
  stt: DEFAULT_STT_STATE,
  oersted: DEFAULT_OERSTED,
  thermal: DEFAULT_THERMAL,
};

// ── IR materialisation helpers ────────────────────────────────

/** Convert SttState to IR fields (matches Python to_ir_fields()). */
export function materializeStt(state: SttState): Record<string, unknown> | null {
  if (state.model === "none") return null;
  if (state.model === "slonczewski") {
    const s = state.slonczewski;
    return {
      current_density: [...s.currentDensity],
      stt_degree: s.degree,
      stt_spin_polarization: [...s.spinPolarization],
      stt_lambda: s.lambdaAsymmetry,
      stt_epsilon_prime: s.epsilonPrime,
    };
  }
  // zhang_li
  const z = state.zhangLi;
  return {
    current_density: [...z.currentDensity],
    stt_degree: z.degree,
    stt_beta: z.beta,
  };
}

/** Convert WaveformState to IR time_dependence dict. */
export function materializeWaveform(
  wf: WaveformState,
): Record<string, unknown> | null {
  switch (wf.kind) {
    case "constant":
      return { kind: "constant" };
    case "sinusoidal":
      return {
        kind: "sinusoidal",
        frequency_hz: wf.sinusoidal.frequencyHz,
        phase_rad: wf.sinusoidal.phaseRad,
        offset: wf.sinusoidal.offset,
      };
    case "pulse":
      return {
        kind: "pulse",
        t_on: wf.pulse.tOn,
        t_off: wf.pulse.tOff,
      };
    case "piecewise_linear":
      return {
        kind: "piecewise_linear",
        points: wf.piecewiseLinearPoints.map((p) => [p.time, p.value]),
      };
  }
}

/** Convert OerstedState to IR energy term dict. */
export function materializeOersted(
  state: OerstedState,
): Record<string, unknown> | null {
  if (!state.enabled) return null;
  const ir: Record<string, unknown> = {
    kind: "oersted_cylinder",
    current: state.current,
    radius: state.radius,
    center: [...state.center],
    axis: [...state.axis],
  };
  if (state.waveform.kind !== "constant") {
    ir.time_dependence = materializeWaveform(state.waveform);
  }
  return ir;
}

/** Convert ThermalState to IR energy term dict. */
export function materializeThermal(
  state: ThermalState,
): Record<string, unknown> | null {
  if (!state.enabled) return null;
  const ir: Record<string, unknown> = {
    kind: "thermal_noise",
    temperature: state.temperature,
  };
  if (state.seed !== null) {
    ir.seed = state.seed;
  }
  return ir;
}
