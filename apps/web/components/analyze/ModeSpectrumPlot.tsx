"use client";

import { useMemo } from "react";
import dynamic from "next/dynamic";

import type { EigenModeSummary } from "./eigenTypes";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

const C = {
  bg: "transparent",
  text: "rgba(225,232,245,0.9)",
  grid: "rgba(120,140,170,0.16)",
  stem: "rgba(76,110,245,0.38)",
  stemSel: "rgba(255,184,108,0.7)",
  sel: "#ffb86c",
  hovBg: "rgba(10,16,28,0.96)",
  hovBorder: "rgba(132,156,240,0.55)",
} as const;

/** Marker color keyed by dominant polarization label emitted by the solver. */
const POL_COLOR: Record<string, string> = {
  ip: "#8ec5ff",
  in_plane: "#8ec5ff",
  op: "#c3a6ff",
  out_of_plane: "#c3a6ff",
  z: "#6ee7b7",
  uniform: "#f9a8d4",
  mixed: "#fcd34d",
  default: "#9cc0ff",
};

function polColor(pol: string): string {
  const key = pol.toLowerCase().replace(/[\s-]/g, "_");
  return POL_COLOR[key] ?? POL_COLOR.default;
}

/** Compact legend pills rendered via Plotly annotations */
function buildLegendAnnotations(): Partial<Plotly.Annotations>[] {
  const entries: [string, string][] = [
    ["ip", "#8ec5ff"],
    ["op", "#c3a6ff"],
    ["z", "#6ee7b7"],
    ["mixed", "#fcd34d"],
  ];
  return entries.map(([label, color], i) => ({
    x: 0 + i * 0.18,
    y: 1.065,
    xref: "paper" as const,
    yref: "paper" as const,
    text: `<span style="color:${color}">●</span> ${label}`,
    showarrow: false,
    font: { size: 9.5, color: "rgba(200,210,230,0.6)", family: "ui-monospace, Menlo, Consolas, monospace" },
    xanchor: "left" as const,
    yanchor: "bottom" as const,
  }));
}

interface ModeSpectrumPlotProps {
  modes: EigenModeSummary[];
  selectedMode: number | null;
  onSelectMode?: (modeIndex: number) => void;
}

function toFrequencyGHz(valueHz: number): number {
  return valueHz / 1e9;
}

export default function ModeSpectrumPlot({
  modes,
  selectedMode,
  onSelectMode,
}: ModeSpectrumPlotProps) {
  const plotData = useMemo(() => {
    const markerX = modes.map((mode) => mode.index);
    const markerY = modes.map((mode) => toFrequencyGHz(mode.frequency_hz));
    const customData = modes.map((mode) => mode.index);

    const stemX: Array<number | null> = [];
    const stemY: Array<number | null> = [];
    for (const mode of modes) {
      stemX.push(mode.index, mode.index, null);
      stemY.push(0, toFrequencyGHz(mode.frequency_hz), null);
    }

    const traces: Partial<Plotly.PlotData>[] = [
      {
        x: stemX,
        y: stemY,
        type: "scatter",
        mode: "lines",
        hoverinfo: "skip",
        line: {
          color: SERIES.stem,
          width: 1.2,
        },
        showlegend: false,
      },
      {
        x: markerX,
        y: markerY,
        type: "scatter",
        mode: "markers",
        name: "Modes",
        customdata: customData,
        marker: {
          color: markerX.map((modeIndex) =>
            modeIndex === selectedMode ? SERIES.selected : SERIES.markers,
          ),
          size: markerX.map((modeIndex) => (modeIndex === selectedMode ? 13 : 10)),
          line: {
            color: "rgba(10, 15, 30, 0.65)",
            width: 1.2,
          },
        },
        hovertemplate:
          "mode %{customdata}<br>f=%{y:.4f} GHz<extra>Eigen spectrum</extra>",
        showlegend: false,
      },
    ];

    return traces;
  }, [modes, selectedMode]);

  const layout = useMemo(
    (): Partial<Plotly.Layout> => ({
      paper_bgcolor: "transparent",
      plot_bgcolor: "transparent",
      margin: { l: 64, r: 20, t: 12, b: 54 },
      font: {
        family: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        size: 11,
        color: SERIES.text,
      },
      xaxis: {
        title: { text: "Mode index", standoff: 8 },
        color: SERIES.text,
        gridcolor: SERIES.grid,
        zeroline: false,
        tickmode: "array",
        tickvals: modes.map((mode) => mode.index),
      },
      yaxis: {
        title: { text: "Frequency (GHz)", standoff: 8 },
        color: SERIES.text,
        gridcolor: SERIES.grid,
        zeroline: false,
      },
      hovermode: "closest",
      dragmode: "pan",
      hoverlabel: {
        bgcolor: "rgba(10, 16, 28, 0.95)",
        bordercolor: "rgba(132, 156, 240, 0.55)",
        font: {
          color: "#eef4ff",
          size: 12,
        },
      },
      modebar: {
        bgcolor: "transparent",
        color: SERIES.text,
        activecolor: SERIES.selected,
      },
    }),
    [modes],
  );

  const config = useMemo(
    (): Partial<Plotly.Config> => ({
      responsive: true,
      displaylogo: false,
      modeBarButtonsToRemove: [
        "lasso2d",
        "select2d",
        "hoverClosestCartesian",
        "hoverCompareCartesian",
        "sendDataToCloud",
      ],
      toImageButtonOptions: {
        format: "png",
        filename: "fullmag_eigen_spectrum",
        scale: 2,
      },
    }),
    [],
  );

  return (
    <Plot
      data={plotData}
      layout={layout}
      config={config}
      useResizeHandler
      className="h-full w-full"
      style={{ width: "100%", height: "100%" }}
      onClick={(event: Readonly<Plotly.PlotMouseEvent>) => {
        const selected = event.points?.[0]?.customdata;
        if (typeof selected === "number") {
          onSelectMode?.(selected);
        }
      }}
    />
  );
}
