"use client";

interface ChartsDockProps {
  scalarRowCount: number;
}

export default function ChartsDock({ scalarRowCount }: ChartsDockProps) {
  return (
    <div className="rounded-md border border-border/30 bg-background/30 p-2 text-xs">
      <div className="font-semibold text-foreground">Charts</div>
      <div className="mt-1 text-muted-foreground">
        Scalar samples: {scalarRowCount.toLocaleString()}
      </div>
    </div>
  );
}

