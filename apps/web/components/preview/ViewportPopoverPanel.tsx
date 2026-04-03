import { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface ViewportPopoverPanelProps {
  children: ReactNode;
  title?: ReactNode;
  className?: string;
}

export function ViewportPopoverPanel({ children, title, className }: ViewportPopoverPanelProps) {
  return (
    <div
      className={cn(
        "absolute top-[calc(100%+0.35rem)] left-0 min-w-[200px] p-2.5 rounded-lg bg-popover/95 backdrop-blur-md border border-border/50 shadow-xl z-20 flex flex-col gap-2 pointer-events-auto",
        className
      )}
    >
      {title && (
        <div className="text-[0.65rem] font-bold uppercase tracking-widest text-muted-foreground pb-1 border-b border-border/30 mb-1">
          {title}
        </div>
      )}
      {children}
    </div>
  );
}

export function ViewportPopoverRow({ children, label }: { children: ReactNode; label: ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-[0.65rem] font-semibold text-muted-foreground w-12 shrink-0">{label}</span>
      <div className="flex items-center gap-1.5 flex-1">{children}</div>
    </div>
  );
}
