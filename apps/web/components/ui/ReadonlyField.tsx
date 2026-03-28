"use client";

import { cn } from "@/lib/utils";

interface ReadonlyFieldProps {
  label: string;
  value: string;
  unit?: string;
  mono?: boolean;
}

export default function ReadonlyField({
  label,
  value,
  unit,
  mono = false,
}: ReadonlyFieldProps) {
  return (
    <div className="flex flex-col gap-1.5 py-3 px-3.5 rounded-md border border-border/40 bg-card/20 min-w-0">
      <div className="flex justify-between gap-3 text-xs font-semibold tracking-widest uppercase text-muted-foreground">
        <span>{label}</span>
      </div>
      <div className={cn("flex items-baseline gap-2 flex-wrap min-w-0 text-foreground", mono && "font-mono")}>
        <strong className="text-sm font-semibold min-w-0 break-words">{value}</strong>
        {unit && <span className="text-sm text-muted-foreground">{unit}</span>}
      </div>
    </div>
  );
}
