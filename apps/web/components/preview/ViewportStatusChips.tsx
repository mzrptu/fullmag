import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface ViewportStatusChipProps {
  children: ReactNode;
  active?: boolean;
  color?: "default" | "primary" | "emerald" | "amber" | "rose" | "cyan";
  className?: string;
}

export function ViewportStatusChip({ children, active, color = "default", className }: ViewportStatusChipProps) {
  return (
    <div
      className={cn(
        "flex items-center h-6 px-2 rounded-full border text-[0.6rem] font-semibold uppercase tracking-widest transition-colors backdrop-blur-md pointer-events-auto shadow-sm",
        color === "default" && "border-border/30 bg-background/50 text-muted-foreground",
        color === "primary" && "border-primary/30 bg-primary/10 text-primary",
        color === "emerald" && "border-emerald-400/30 bg-emerald-500/10 text-emerald-300",
        color === "amber" && "border-amber-400/30 bg-amber-500/10 text-amber-300",
        color === "rose" && "border-rose-400/30 bg-rose-500/10 text-rose-300",
        color === "cyan" && "border-cyan-400/30 bg-cyan-500/10 text-cyan-300",
        active && "border-primary/45 bg-primary/18 text-primary",
        className
      )}
    >
      {children}
    </div>
  );
}
