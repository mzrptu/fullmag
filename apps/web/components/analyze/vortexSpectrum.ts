/**
 * Client-side FFT / PSD computation for vortex time-trace analysis.
 *
 * Uses the browser's built-in functionality (no external FFT library required).
 * For production accuracy, consider replacing with a Web Worker + FFT library.
 */

import type {
  FftWindow,
  LinewidthResult,
  VortexSpectrumConfig,
  VortexSpectrumResult,
  VortexTimeSample,
} from "./vortexTypes";

/* ── Window functions ─────────────────────────────── */

function windowFn(name: FftWindow, n: number): Float64Array {
  const w = new Float64Array(n);
  if (name === "none") {
    w.fill(1);
    return w;
  }
  for (let i = 0; i < n; i++) {
    const x = (2 * Math.PI * i) / (n - 1);
    switch (name) {
      case "hann":
        w[i] = 0.5 * (1 - Math.cos(x));
        break;
      case "hamming":
        w[i] = 0.54 - 0.46 * Math.cos(x);
        break;
      case "blackman":
        w[i] = 0.42 - 0.5 * Math.cos(x) + 0.08 * Math.cos(2 * x);
        break;
    }
  }
  return w;
}

/* ── Naive DFT (O(n²)) for small-to-medium datasets ─ */

function realDft(
  signal: Float64Array,
): { re: Float64Array; im: Float64Array } {
  const n = signal.length;
  const nf = Math.floor(n / 2) + 1;
  const re = new Float64Array(nf);
  const im = new Float64Array(nf);
  for (let k = 0; k < nf; k++) {
    let sr = 0;
    let si = 0;
    for (let t = 0; t < n; t++) {
      const angle = (2 * Math.PI * k * t) / n;
      sr += signal[t] * Math.cos(angle);
      si -= signal[t] * Math.sin(angle);
    }
    re[k] = sr;
    im[k] = si;
  }
  return { re, im };
}

/* ── PSD for a single channel ────────────────────── */

function channelPsd(
  values: Float64Array,
  win: Float64Array,
  fs: number,
): Float64Array {
  const n = values.length;

  // Subtract mean
  let mean = 0;
  for (let i = 0; i < n; i++) mean += values[i];
  mean /= n;

  const windowed = new Float64Array(n);
  let winPow = 0;
  for (let i = 0; i < n; i++) {
    windowed[i] = (values[i] - mean) * win[i];
    winPow += win[i] * win[i];
  }

  const { re, im } = realDft(windowed);
  const nf = re.length;
  const psd = new Float64Array(nf);

  for (let k = 0; k < nf; k++) {
    psd[k] = (2 * (re[k] * re[k] + im[k] * im[k])) / (winPow * fs);
  }
  // DC and Nyquist: not doubled
  psd[0] /= 2;
  if (nf > 1 && n % 2 === 0) psd[nf - 1] /= 2;

  return psd;
}

/* ── Public API ──────────────────────────────────── */

export function computeVortexSpectrum(
  samples: VortexTimeSample[],
  config: VortexSpectrumConfig,
): VortexSpectrumResult {
  // Filter transient
  let data = samples;
  if (config.discardTransientS > 0) {
    data = data.filter((s) => s.time >= config.discardTransientS);
  }
  if (data.length < 4) {
    return {
      frequencies: [],
      psd_mx: [],
      psd_my: [],
      psd_mz: [],
      peak_frequency_hz: null,
      peak_channel: null,
    };
  }

  const n = data.length;
  const dt = (data[n - 1].time - data[0].time) / (n - 1);
  const fs = 1 / dt;

  const win = windowFn(config.window, n);

  const mxArr = new Float64Array(n);
  const myArr = new Float64Array(n);
  const mzArr = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    mxArr[i] = data[i].mx;
    myArr[i] = data[i].my;
    mzArr[i] = data[i].mz;
  }

  const psdMx = channelPsd(mxArr, win, fs);
  const psdMy = channelPsd(myArr, win, fs);
  const psdMz = channelPsd(mzArr, win, fs);

  const nf = psdMx.length;
  const freqs = new Array<number>(nf);
  for (let k = 0; k < nf; k++) {
    freqs[k] = (k * fs) / n;
  }

  // Find global peak
  let bestPower = -1;
  let bestK = 0;
  let bestCh: "mx" | "my" | "mz" = "mx";
  for (let k = 1; k < nf; k++) {
    const f = freqs[k];
    if (f < config.fMinHz) continue;
    if (config.fMaxHz != null && f > config.fMaxHz) continue;
    for (const [ch, psd] of [
      ["mx", psdMx],
      ["my", psdMy],
      ["mz", psdMz],
    ] as const) {
      if (psd[k] > bestPower) {
        bestPower = psd[k];
        bestK = k;
        bestCh = ch;
      }
    }
  }

  return {
    frequencies: freqs,
    psd_mx: Array.from(psdMx),
    psd_my: Array.from(psdMy),
    psd_mz: Array.from(psdMz),
    peak_frequency_hz: bestPower > 0 ? freqs[bestK] : null,
    peak_channel: bestPower > 0 ? bestCh : null,
  };
}

/** Estimate FWHM linewidth around a peak using half-maximum crossing. */
export function estimateLinewidth(
  frequencies: number[],
  psd: number[],
  fCenter: number,
): LinewidthResult {
  if (frequencies.length === 0) {
    return { f_center_hz: fCenter, fwhm_hz: 0, peak_power: 0 };
  }

  let peakIdx = 0;
  let peakPower = 0;
  for (let i = 0; i < frequencies.length; i++) {
    if (psd[i] > peakPower) {
      peakPower = psd[i];
      peakIdx = i;
    }
  }

  const halfMax = peakPower / 2;
  let iLow = peakIdx;
  let iHigh = peakIdx;
  while (iLow > 0 && psd[iLow] >= halfMax) iLow--;
  while (iHigh < frequencies.length - 1 && psd[iHigh] >= halfMax) iHigh++;

  return {
    f_center_hz: frequencies[peakIdx],
    fwhm_hz: frequencies[iHigh] - frequencies[iLow],
    peak_power: peakPower,
  };
}
