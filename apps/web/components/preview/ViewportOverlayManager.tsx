"use client";

import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export type ViewportOverlayAnchor =
  | "top-left"
  | "top-center"
  | "top-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right";

export type ViewportOverlayMode = "full" | "compact" | "icon";

function anchorClass(anchor: ViewportOverlayAnchor): string {
  switch (anchor) {
    case "top-left":
      return "top-3 left-3 items-start";
    case "top-center":
      return "top-3 left-1/2 -translate-x-1/2 items-center";
    case "top-right":
      return "top-3 right-3 items-end";
    case "bottom-left":
      return "bottom-3 left-3 items-start";
    case "bottom-center":
      return "bottom-3 left-1/2 -translate-x-1/2 items-center";
    case "bottom-right":
      return "bottom-3 right-3 items-end";
    default:
      return "top-3 left-3 items-start";
  }
}

export function ViewportOverlayManager({
  className,
  children,
}: {
  className?: string;
  children: (layout: {
    width: number;
    height: number;
    mode: ViewportOverlayMode;
  }) => ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect;
      if (!next) {
        return;
      }
      setSize({ width: next.width, height: next.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const mode = useMemo<ViewportOverlayMode>(() => {
    const { width, height } = size;
    if (width > 0 && (width < 1024 || height < 480)) {
      return "icon";
    }
    if (width > 0 && (width < 1440 || height < 640)) {
      return "compact";
    }
    return "full";
  }, [size.width, size.height]);

  return (
    <div ref={ref} className={cn("pointer-events-none absolute inset-0 z-20", className)}>
      {children({ width: size.width, height: size.height, mode })}
    </div>
  );
}

export function ViewportOverlaySlot({
  anchor,
  className,
  children,
}: {
  anchor: ViewportOverlayAnchor;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("absolute flex flex-col gap-2", anchorClass(anchor), className)}>
      {children}
    </div>
  );
}
