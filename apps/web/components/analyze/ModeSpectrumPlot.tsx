"use client";

import { useMemo } from "react";
import dynamic from "next/dynamic";

import type { EigenModeSummary } from "./eigenTypes";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

const SERIES = {
  stem: "#4c6ef5",
  markers: "#9cc0ff",
  selected: "#ffb86c",
  text: "rgba(225, 232, 245, 0.9)",
  grid: "rgba(120, 140, 170, 0.16)",
};

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
