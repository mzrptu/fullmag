"use client";

import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";

import { ViewportOverlayLayout } from "./ViewportOverlayLayout";

export type ViewportOverlayAnchor =
  | "top-left"
  | "top-center"
  | "top-right"
  | "left"
  | "right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right";

export type ViewportOverlayMode = "full" | "compact" | "icon";

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
    <div ref={ref} className="absolute inset-0 pointer-events-none z-20">
      <ViewportOverlayLayout className={className}>
        {children({ width: size.width, height: size.height, mode })}
      </ViewportOverlayLayout>
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
  switch (anchor) {
    case "top-left":
      return <ViewportOverlayLayout.TopLeft className={className}>{children}</ViewportOverlayLayout.TopLeft>;
    case "top-center":
      return <ViewportOverlayLayout.TopCenter className={className}>{children}</ViewportOverlayLayout.TopCenter>;
    case "top-right":
      return <ViewportOverlayLayout.TopRight className={className}>{children}</ViewportOverlayLayout.TopRight>;
    case "left":
      return <ViewportOverlayLayout.Left className={className}>{children}</ViewportOverlayLayout.Left>;
    case "right":
      return <ViewportOverlayLayout.Right className={className}>{children}</ViewportOverlayLayout.Right>;
    case "bottom-left":
      return <ViewportOverlayLayout.BottomLeft className={className}>{children}</ViewportOverlayLayout.BottomLeft>;
    case "bottom-center":
      return <ViewportOverlayLayout.BottomCenter className={className}>{children}</ViewportOverlayLayout.BottomCenter>;
    case "bottom-right":
      return <ViewportOverlayLayout.BottomRight className={className}>{children}</ViewportOverlayLayout.BottomRight>;
    default:
      return <ViewportOverlayLayout.TopLeft className={className}>{children}</ViewportOverlayLayout.TopLeft>;
  }
}
