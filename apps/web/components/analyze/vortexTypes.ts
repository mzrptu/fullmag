/**
 * Types for vortex STNO analysis workspace.
 *
 * These types describe the data flowing from the engine's scalar outputs
 * (mx(t), my(t), mz(t)) into the vortex analysis panels: time traces,
 * FFT/PSD, orbit trajectory, and derived quantities.
 */

/** A single time-domain sample from scalar outputs. */
export interface VortexTimeSample {
  time: number;
  mx: number;
  my: number;
  mz: number;
}

/** Result of an FFT / PSD computation. */
export interface VortexSpectrumResult {
  frequencies: number[];            // Hz
  psd_mx: number[];                 // [a.u.]
  psd_my: number[];
  psd_mz: number[];
  peak_frequency_hz: number | null;
  peak_channel: "mx" | "my" | "mz" | null;
}

/** Lorentzian linewidth fit result. */
export interface LinewidthResult {
  f_center_hz: number;
  fwhm_hz: number;
  peak_power: number;
}

/** Vortex core trajectory point (if vortex tracking is active). */
export interface VortexCorePoint {
  time: number;
  xc: number;   // [m]
  yc: number;   // [m]
}

/** Derived vortex orbit diagnostics. */
export interface VortexOrbitDiagnostics {
  mean_radius_m: number;
  frequency_hz: number | null;
  chirality: "cw" | "ccw" | null;
  /** Phase drift rate [rad/s] (zero for steady oscillation). */
  drift_rate: number;
}

/** Available channels for time-trace inspection. */
export const VORTEX_CHANNELS = ["mx", "my", "mz"] as const;
export type VortexChannel = (typeof VORTEX_CHANNELS)[number];

/** FFT window function choices exposed in the UI. */
export const FFT_WINDOWS = ["hann", "hamming", "blackman", "none"] as const;
export type FftWindow = (typeof FFT_WINDOWS)[number];

/** Configuration for spectrum computation. */
export interface VortexSpectrumConfig {
  window: FftWindow;
  discardTransientS: number;
  fMinHz: number;
  fMaxHz: number | null;
}

export const DEFAULT_SPECTRUM_CONFIG: VortexSpectrumConfig = {
  window: "hann",
  discardTransientS: 0,
  fMinHz: 0,
  fMaxHz: null,
};
