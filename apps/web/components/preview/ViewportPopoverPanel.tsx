import { ReactNode, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export interface ViewportPopoverPanelProps {
  children: ReactNode;
  title?: ReactNode;
  className?: string;
  preferredHorizontal?: "left" | "right";
  preferredVertical?: "bottom" | "top";
}

export function ViewportPopoverPanel({
  children,
  title,
  className,
  preferredHorizontal = "left",
  preferredVertical = "bottom",
}: ViewportPopoverPanelProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [resolvedHorizontal, setResolvedHorizontal] = useState(preferredHorizontal);
  const [resolvedVertical, setResolvedVertical] = useState(preferredVertical);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || typeof window === "undefined") {
      return;
    }
    const rect = element.getBoundingClientRect();
    setResolvedHorizontal(
      preferredHorizontal === "left"
        ? rect.right > window.innerWidth - 12
          ? "right"
          : "left"
        : rect.left < 12
          ? "left"
          : "right",
    );
    setResolvedVertical(
      preferredVertical === "bottom"
        ? rect.bottom > window.innerHeight - 12
          ? "top"
          : "bottom"
        : rect.top < 12
          ? "bottom"
          : "top",
    );
  }, [children, preferredHorizontal, preferredVertical, title]);

  return (
    <div
      ref={ref}
      className={cn(
        "absolute min-w-[200px] p-2.5 rounded-lg bg-popover/95 backdrop-blur-md border border-border/50 shadow-xl z-20 flex flex-col gap-2 pointer-events-auto",
        resolvedVertical === "bottom" ? "top-[calc(100%+0.35rem)]" : "bottom-[calc(100%+0.35rem)]",
        resolvedHorizontal === "left" ? "left-0" : "right-0",
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
