"use client";

import { useMemo } from "react";

interface SparklineProps {
  /** Array of numeric values to plot */
  data: number[];
  /** Width in px */
  width?: number;
  /** Height in px */
  height?: number;
  /** Stroke color (CSS value) */
  color?: string;
  /** Show a filled area under the line */
  fill?: boolean;
  /** Label shown on the right end */
  label?: string;
}

export default function Sparkline({
  data,
  width = 100,
  height = 24,
  color = "hsl(210, 60%, 55%)",
  fill = true,
  label,
}: SparklineProps) {
  const path = useMemo(() => {
    if (data.length < 2) return "";

    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;
    const pad = 1;
    const h = height - pad * 2;
    const w = width - (label ? 30 : 0);
    const stepX = w / (data.length - 1);

    const points = data.map((v, i) => {
      const x = i * stepX;
      const y = pad + h - ((v - min) / range) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });

    return `M${points.join("L")}`;
  }, [data, width, height, label]);

  const fillPath = useMemo(() => {
    if (!fill || data.length < 2) return "";
    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;
    const pad = 1;
    const h = height - pad * 2;
    const w = width - (label ? 30 : 0);
    const stepX = w / (data.length - 1);

    const points = data.map((v, i) => {
      const x = i * stepX;
      const y = pad + h - ((v - min) / range) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });

    return `M0,${height} L${points.join("L")} L${((data.length - 1) * stepX).toFixed(1)},${height} Z`;
  }, [data, width, height, fill, label]);

  if (data.length < 2) {
    return (
      <svg width={width} height={height} style={{ display: "block" }}>
        <text
          x={width / 2}
          y={height / 2 + 3}
          textAnchor="middle"
          fill="var(--text-3)"
          fontSize="8"
          fontFamily="var(--font-mono, monospace)"
        >
          —
        </text>
      </svg>
    );
  }

  return (
    <svg width={width} height={height} style={{ display: "block" }}>
      {fill && (
        <path d={fillPath} fill={color} opacity={0.12} />
      )}
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth={1.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Current value dot */}
      {data.length > 0 && (() => {
        const min = Math.min(...data);
        const max = Math.max(...data);
        const range = max - min || 1;
        const pad = 1;
        const h = height - pad * 2;
        const w = width - (label ? 30 : 0);
        const last = data[data.length - 1];
        const cx = (data.length - 1) * (w / (data.length - 1));
        const cy = pad + h - ((last - min) / range) * h;
        return (
          <circle cx={cx} cy={cy} r={2} fill={color} />
        );
      })()}
      {label && (
        <text
          x={width - 2}
          y={height / 2 + 3}
          textAnchor="end"
          fill="var(--text-2)"
          fontSize="7"
          fontFamily="var(--font-mono, monospace)"
        >
          {label}
        </text>
      )}
    </svg>
  );
}
