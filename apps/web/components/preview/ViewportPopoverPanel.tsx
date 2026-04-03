"use client";

import {
  ReactNode,
  RefObject,
  useLayoutEffect,
  useRef,
  useState,
  useEffect,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

// ─── types ────────────────────────────────────────────────────────────────────

export interface ViewportPopoverPanelProps {
  /** The button/icon that triggered this popover. Used to compute anchor position. */
  anchorRef: RefObject<HTMLElement | null>;
  children: ReactNode;
  title?: ReactNode;
  className?: string;
  /** Which horizontal edge of the *anchor* to align against first. Default "left". */
  preferredHorizontal?: "left" | "right";
  /** Open below or above the anchor first. Default "bottom". */
  preferredVertical?: "bottom" | "top";
}

// ─── component ────────────────────────────────────────────────────────────────

export function ViewportPopoverPanel({
  anchorRef,
  children,
  title,
  className,
  preferredHorizontal = "left",
  preferredVertical = "bottom",
}: ViewportPopoverPanelProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [style, setStyle] = useState<React.CSSProperties>({ visibility: "hidden", position: "fixed" });
  const [mounted, setMounted] = useState(false);

  // Wait for client‐side mount before portal is used.
  useEffect(() => setMounted(true), []);

  useLayoutEffect(() => {
    if (!mounted) return;

    function reposition() {
      const anchor = anchorRef.current;
      const panel = panelRef.current;
      if (!anchor || !panel || typeof window === "undefined") return;

      const aRect = anchor.getBoundingClientRect();
      const pRect = panel.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const GAP = 6; // px between anchor and panel
      const MARGIN = 8; // min distance from viewport edges

      // ── Vertical ────────────────────────────────────────────────────────────
      let top: number;
      if (preferredVertical === "bottom") {
        const candidate = aRect.bottom + GAP;
        if (candidate + pRect.height > vh - MARGIN) {
          // Not enough room below → open above
          top = aRect.top - GAP - pRect.height;
        } else {
          top = candidate;
        }
      } else {
        const candidate = aRect.top - GAP - pRect.height;
        if (candidate < MARGIN) {
          // Not enough room above → open below
          top = aRect.bottom + GAP;
        } else {
          top = candidate;
        }
      }
      top = Math.max(MARGIN, Math.min(top, vh - pRect.height - MARGIN));

      // ── Horizontal ──────────────────────────────────────────────────────────
      let left: number;
      if (preferredHorizontal === "left") {
        // Align panel's LEFT edge to anchor's LEFT edge
        left = aRect.left;
        if (left + pRect.width > vw - MARGIN) {
          // Overflows right → align panel's RIGHT edge to anchor's RIGHT edge
          left = aRect.right - pRect.width;
        }
      } else {
        // Align panel's RIGHT edge to anchor's RIGHT edge
        left = aRect.right - pRect.width;
        if (left < MARGIN) {
          // Overflows left → align panel's LEFT edge to anchor's LEFT edge
          left = aRect.left;
        }
      }
      left = Math.max(MARGIN, Math.min(left, vw - pRect.width - MARGIN));

      setStyle({
        position: "fixed",
        top,
        left,
        visibility: "visible",
      });
    }

    reposition();
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [mounted, anchorRef, children, preferredHorizontal, preferredVertical, title]);

  if (!mounted) return null;

  return createPortal(
    <div
      ref={panelRef}
      style={style}
      className={cn(
        "min-w-[200px] max-w-[320px] p-2.5 rounded-lg z-[9999]",
        "bg-popover/95 backdrop-blur-md border border-border/50 shadow-xl",
        "flex flex-col gap-2 pointer-events-auto",
        "max-h-[min(22rem,calc(100vh-2rem))] overflow-y-auto",
        className,
      )}
    >
      {title && (
        <div className="text-[0.65rem] font-bold uppercase tracking-widest text-muted-foreground pb-1 border-b border-border/30 mb-1 sticky top-0 bg-popover/95">
          {title}
        </div>
      )}
      {children}
    </div>,
    document.body,
  );
}

// ─── helper row ──────────────────────────────────────────────────────────────

export function ViewportPopoverRow({ children, label }: { children: ReactNode; label: ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-[0.65rem] font-semibold text-muted-foreground w-12 shrink-0">{label}</span>
      <div className="flex items-center gap-1.5 flex-1">{children}</div>
    </div>
  );
}
