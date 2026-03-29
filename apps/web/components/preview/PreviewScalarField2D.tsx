"use client";

import { useEffect, useMemo, useRef } from "react";
import * as echarts from "echarts";
import { DIVERGING_PALETTE, SEQUENTIAL_BLUE_PALETTE, POSITIVE_PALETTE } from "../../lib/colorPalettes";
import { ECHARTS_THEME } from "../../lib/echartsTheme";

interface Props {
  data: [number, number, number][];
  grid: [number, number, number];
  quantityLabel: string;
  quantityUnit?: string;
  component: string;
  min: number;
  max: number;
}

const NEGATIVE_PALETTE = SEQUENTIAL_BLUE_PALETTE;
const THEME = ECHARTS_THEME;

function getColorScale(min: number, max: number) {
  if (min < 0 && max > 0) {
    const bound = Math.max(Math.abs(min), Math.abs(max));
    return { min: -bound, max: bound, palette: DIVERGING_PALETTE };
  }
  if (max <= 0) return { min, max, palette: NEGATIVE_PALETTE };
  return { min, max, palette: POSITIVE_PALETTE };
}

function formatMagnitude(value: number): string {
  if (!Number.isFinite(value)) return "NaN";
  if (value === 0) return "0";
  const abs = Math.abs(value);
  if (abs >= 1000 || abs < 1e-2) return value.toExponential(2);
  if (abs >= 10) return value.toFixed(1);
  if (abs >= 1) return value.toFixed(2);
  return value.toPrecision(2);
}

export default function PreviewScalarField2D({
  data,
  grid,
  quantityLabel,
  quantityUnit,
  component,
  min,
  max,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  const { xLen, yLen, scale } = useMemo(() => {
    const xLen = Math.max(1, grid[0]);
    const yLen = Math.max(1, grid[1]);
    return {
      xLen,
      yLen,
      scale: getColorScale(min, max),
    };
  }, [grid, max, min]);

  useEffect(() => {
    if (!containerRef.current || !data.length) return;

    if (!chartRef.current || chartRef.current.isDisposed()) {
      chartRef.current = echarts.init(containerRef.current, undefined, {
        renderer: "canvas",
      });
    }

    const chart = chartRef.current;
    const xCategories = Array.from({ length: xLen }, (_, i) => i);
    const yCategories = Array.from({ length: yLen }, (_, i) => i);

    chart.setOption(
      {
        animation: false,
        grid: { left: 56, right: 18, top: 24, bottom: 56, containLabel: true },
        tooltip: {
          position: "top",
          confine: true,
          formatter: (params: Record<string, unknown>) => {
            const value = params.value as number[];
            return [
              `<strong>${quantityLabel}.${component}</strong>`,
              `x: ${value[0]}`,
              `y: ${value[1]}`,
              `value: ${formatMagnitude(value[2])}${quantityUnit ? ` ${quantityUnit}` : ""}`,
            ].join("<br/>");
          },
          backgroundColor: THEME.tooltipBg,
          borderColor: THEME.tooltipBorder,
          borderWidth: 1,
          padding: [10, 12],
          textStyle: { color: THEME.tooltipText, fontSize: 12 },
        },
        xAxis: {
          type: "category",
          data: xCategories,
          name: "x (preview)",
          nameLocation: "middle",
          nameGap: 28,
          nameTextStyle: { color: THEME.text2, fontWeight: 600 },
          axisLine: { show: true, lineStyle: { color: THEME.border } },
          axisLabel: { color: THEME.text2, hideOverlap: true },
          splitLine: { show: false },
        },
        yAxis: {
          type: "category",
          data: yCategories,
          name: "y (preview)",
          nameLocation: "middle",
          nameGap: 38,
          nameTextStyle: { color: THEME.text2, fontWeight: 600 },
          axisLine: { show: true, lineStyle: { color: THEME.border } },
          axisLabel: { color: THEME.text2, hideOverlap: true },
          splitLine: { show: false },
        },
        visualMap: {
          min: scale.min,
          max: scale.max,
          calculable: false,
          orient: "horizontal",
          left: "center",
          bottom: 8,
          inRange: { color: scale.palette },
          textStyle: { color: THEME.text2 },
        },
        series: [
          {
            type: "heatmap",
            data,
            progressive: 0,
            emphasis: {
              itemStyle: {
                borderColor: "#edf3fb",
                borderWidth: 1,
              },
            },
          },
        ],
      },
      true,
    );

    const resize = () => chart.resize();
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
    };
  }, [component, data, quantityLabel, quantityUnit, scale.max, scale.min, scale.palette, xLen, yLen]);

  useEffect(() => {
    return () => {
      if (chartRef.current && !chartRef.current.isDisposed()) {
        chartRef.current.dispose();
      }
    };
  }, []);

  return <div ref={containerRef} className="h-full w-full" />;
}
