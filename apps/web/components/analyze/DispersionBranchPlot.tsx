"use client";

import { useMemo } from "react";
import dynamic from "next/dynamic";

import type { DispersionRow } from "./eigenTypes";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

const COLORS = [
  "#8ec5ff",
  "#ff9b85",
  "#8ce99a",
  "#ffd166",
  "#c3a6ff",
  "#5eead4",
  "#f9a8d4",
  "#facc15",
];

interface DispersionBranchPlotProps {
  rows: DispersionRow[];
  selectedMode: number | null;
  onSelectMode?: (modeIndex: number) => void;
}

function kMagnitude(row: DispersionRow): number {
  return Math.sqrt(row.kx ** 2 + row.ky ** 2 + row.kz ** 2);
}

export default function DispersionBranchPlot({
  rows,
  selectedMode,
  onSelectMode,
}: DispersionBranchPlotProps) {
  const traces = useMemo(() => {
    const grouped = new Map<number, DispersionRow[]>();
    for (const row of rows) {
      const entries = grouped.get(row.modeIndex);
      if (entries) {
        entries.push(row);
      } else {
        grouped.set(row.modeIndex, [row]);
      }
    }

    return Array.from(grouped.entries())
      .sort((left, right) => left[0] - right[0])
      .map(([modeIndex, entries], index) => {
        const ordered = [...entries].sort((left, right) => kMagnitude(left) - kMagnitude(right));
        return {
          x: ordered.map(kMagnitude),
          y: ordered.map((row) => row.frequencyHz / 1e9),
          type: "scatter" as const,
          mode: ordered.length > 1 ? ("lines+markers" as const) : ("markers" as const),
          name: `Mode ${modeIndex}`,
          customdata: ordered.map((row) => row.modeIndex),
          line: {
            color: modeIndex === selectedMode ? "#ffb86c" : COLORS[index % COLORS.length],
            width: modeIndex === selectedMode ? 2.6 : 1.6,
          },
          marker: {
            color: modeIndex === selectedMode ? "#ffb86c" : COLORS[index % COLORS.length],
            size: modeIndex === selectedMode ? 10 : 7,
          },
          hovertemplate:
            "mode %{customdata}<br>|k|=%{x:.4e} 1/m<br>f=%{y:.4f} GHz<extra>Dispersion</extra>",
          showlegend: ordered.length > 1,
        };
      });
  }, [rows, selectedMode]);

  const layout = useMemo(
    (): Partial<Plotly.Layout> => ({
      paper_bgcolor: "transparent",
      plot_bgcolor: "transparent",
      margin: { l: 72, r: 20, t: 12, b: 56 },
      font: {
        family: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        size: 11,
        color: "rgba(225, 232, 245, 0.9)",
      },
      xaxis: {
        title: { text: "|k| (1/m)", standoff: 8 },
        gridcolor: "rgba(120, 140, 170, 0.16)",
        zeroline: false,
        exponentformat: "e",
      },
      yaxis: {
        title: { text: "Frequency (GHz)", standoff: 8 },
        gridcolor: "rgba(120, 140, 170, 0.16)",
        zeroline: false,
      },
      hovermode: "closest",
      dragmode: "pan",
      legend: {
        orientation: "h",
        yanchor: "top",
        y: -0.18,
        xanchor: "left",
        x: 0,
      },
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
        color: "rgba(225, 232, 245, 0.9)",
        activecolor: "#ffb86c",
      },
    }),
    [],
  );

  return (
    <Plot
      data={traces}
      layout={layout}
      config={{
        responsive: true,
        displaylogo: false,
        modeBarButtonsToRemove: [
          "lasso2d",
          "select2d",
          "hoverClosestCartesian",
          "hoverCompareCartesian",
          "sendDataToCloud",
        ],
      }}
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
