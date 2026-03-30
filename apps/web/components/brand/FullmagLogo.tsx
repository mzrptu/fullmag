"use client";

import { cn } from "@/lib/utils";
import React, { useMemo, useEffect, useState, useId } from "react";
import { createPortal } from "react-dom";

/* ────────────────────────────────────────────────────────────
   FullmagLogo — High-Fidelity Infinity Loop Vector Mark

   Design: 1:1 Reference Match
   - Overall Shape: Continuous sleek infinity loop (lemniscate).
   - Left Ribbon (FDM): Thick cyan/blue ribbon with diagonal grid wireframe & glowing blocks.
   - Right Ribbon (FEM): Thick purple ribbon with Delaunay triangular wireframe.
   - Center: Blazing singularity overlay at the crossover point.
   ────────────────────────────────────────────────────────── */

interface FullmagLogoProps {
  size?: number;
  animate?: boolean;
  spin?: boolean;
  className?: string;
}

export default function FullmagLogo({
  size = 64,
  animate = false,
  spin = false,
  className,
}: FullmagLogoProps) {
  const [zoomed, setZoomed] = useState(false);
  const [mounted, setMounted] = useState(false);
  const baseId = useId();
  const id = `fml-${baseId.replace(/:/g, "")}`;
  
  useEffect(() => {
    setMounted(true);
  }, []);

  const svgContent = (
    <>
      <defs>
        {/* Gradients */}
        <linearGradient id={`${id}-left-grad`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#89b4fa" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#b4befe" stopOpacity="0.7" />
        </linearGradient>

        <linearGradient id={`${id}-right-grad`} x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#cba6f7" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#f5c2e7" stopOpacity="0.7" />
        </linearGradient>

        <radialGradient id={`${id}-core-glow`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="1" />
          <stop offset="20%" stopColor="#b4befe" stopOpacity="0.8" />
          <stop offset="50%" stopColor="#cba6f7" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#1e1e2e" stopOpacity="0" />
        </radialGradient>

        {/* Filters */}
        <filter id={`${id}-glow-blur`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="6" />
        </filter>
        <filter id={`${id}-core-blur`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" />
        </filter>
        <filter id={`${id}-specular`}>
          <feGaussianBlur stdDeviation="0.8" />
        </filter>

        {/* Infinity Paths (C1 Continuous Figure-8 Intersection) */}
        {/* Left loop path entering from top-left, looping, and aiming top-right through center */}
        <path id={`${id}-path-left`} d="M 100,60 C 60,10 15,20 15,60 C 15,100 60,110 100,60" fill="none" />
        {/* Right loop path emerging to bottom-right, looping, and returning bottom-left through center */}
        <path id={`${id}-path-right`} d="M 100,60 C 140,110 185,100 185,60 C 185,20 140,10 100,60" fill="none" />

        {/* Masks cutting the exact ribbon volume */}
        <mask id={`${id}-mask-left`}>
          <use href={`#${id}-path-left`} stroke="#ffffff" strokeWidth="24" strokeLinecap="round" strokeLinejoin="round" />
        </mask>
        <mask id={`${id}-mask-right`}>
          <use href={`#${id}-path-right`} stroke="#ffffff" strokeWidth="24" strokeLinecap="round" strokeLinejoin="round" />
        </mask>

        {/* FDM Grid Pattern */}
        <pattern id={`${id}-fdm-pattern`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(15)">
          <path d="M 6 0 L 0 0 0 6" fill="none" stroke="#11111b" strokeWidth="0.8" opacity="0.6" />
          <path d="M 6 0 L 0 0 0 6" fill="none" stroke="#ffffff" strokeWidth="0.3" opacity="0.4" />
        </pattern>
      </defs>

      {/* --- Ambient Backdrop Glow --- */}
      <circle cx="50" cy="60" r="40" fill="#89b4fa" opacity="0.15" filter={`url(#${id}-glow-blur)`} />
      <circle cx="150" cy="60" r="40" fill="#cba6f7" opacity="0.15" filter={`url(#${id}-glow-blur)`} />

      {/* --- RIGHT RIBBON (FEM) --- */}
      <g>
        {/* Volumetric Drop Shadow Glow */}
        <use href={`#${id}-path-right`} stroke="#cba6f7" strokeWidth="26" filter={`url(#${id}-glow-blur)`} opacity="0.4" />
        
        {/* Solid Glass Base */}
        <use href={`#${id}-path-right`} stroke={`url(#${id}-right-grad)`} strokeWidth="24" strokeLinecap="round" />
        
        {/* Inner Glint (Specular Volume) */}
        <use href={`#${id}-path-right`} stroke="#ffffff" strokeWidth="22" strokeLinecap="round" opacity="0.15" filter={`url(#${id}-specular)`} />
        
        {/* Textures (Clipped to Ribbon) */}
        <g mask={`url(#${id}-mask-right)`}>
          <FEMWireframe id={id} />
        </g>

        {/* Crisp Ribbon Edge Line */}
        <use href={`#${id}-path-right`} stroke="#f5c2e7" strokeWidth="1" strokeLinecap="round" opacity="0.8" />
      </g>

      {/* --- LEFT RIBBON (FDM) --- */}
      <g>
        {/* Volumetric Drop Shadow Glow */}
        <use href={`#${id}-path-left`} stroke="#89b4fa" strokeWidth="26" filter={`url(#${id}-glow-blur)`} opacity="0.4" />
        
        {/* Solid Glass Base */}
        <use href={`#${id}-path-left`} stroke={`url(#${id}-left-grad)`} strokeWidth="24" strokeLinecap="round" />
        
        {/* Inner Glint (Specular Volume) */}
        <use href={`#${id}-path-left`} stroke="#ffffff" strokeWidth="22" strokeLinecap="round" opacity="0.15" filter={`url(#${id}-specular)`} />
        
        {/* Textures (Clipped to Ribbon) */}
        <g mask={`url(#${id}-mask-left)`}>
          <rect x="0" y="0" width="120" height="120" fill={`url(#${id}-fdm-pattern)`} />
          <FDMSquares />
        </g>

        {/* Crisp Ribbon Edge Line */}
        <use href={`#${id}-path-left`} stroke="#89b4fa" strokeWidth="1" strokeLinecap="round" opacity="0.8" />
      </g>

      {/* --- FLOATING FRAGMENTS --- */}
      <FloatingDebris />

      {/* --- CENTER SINGULARITY (Cross-over flare) --- */}
      {/* 
        Placing this on top ensures the intersection is completely blown out by light, 
        giving the "infinite loop intersection" aesthetic.
      */}
      <circle cx="100" cy="60" r="16" fill={`url(#${id}-core-glow)`} filter={`url(#${id}-glow-blur)`} />
      <circle cx="100" cy="60" r="5" fill="#ffffff" filter={`url(#${id}-core-blur)`} />
      <circle cx="100" cy="60" r="2" fill="#ffffff" />

      {/* --- ANIMATED ORBITING ENERGY --- */}
      {(animate || zoomed) && (
        <g>
          {/* Energy spark traveling the left arc */}
          <circle cx="0" cy="0" r="2.5" fill="#ffffff" filter={`url(#${id}-core-blur)`}>
             <animateMotion dur="2.5s" repeatCount="indefinite">
                <mpath href={`#${id}-path-left`} />
             </animateMotion>
          </circle>
          {/* Energy spark traveling the right arc */}
          <circle cx="0" cy="0" r="2.5" fill="#ffffff" filter={`url(#${id}-core-blur)`}>
             <animateMotion dur="2.5s" repeatCount="indefinite">
                <mpath href={`#${id}-path-right`} />
             </animateMotion>
          </circle>
        </g>
      )}
    </>
  );

  return (
    <>
      {/* ── Standard UI Render ── */}
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 200 120"
        width={size}
        height={size * 0.6}
        className={cn(
          "select-none cursor-pointer transition-opacity hover:opacity-80", 
          spin && "animate-[spin_4s_linear_infinite]", 
          className
        )}
        onClick={() => setZoomed(true)}
        role="img"
        aria-label="Fullmag Infinity Logo"
      >
        {svgContent}
      </svg>

      {/* ── Zoom Modal Render ── */}
      {zoomed && mounted && createPortal(
        <div 
          className="fixed inset-0 z-[99999] p-4 sm:p-8 flex items-center justify-center bg-background/90 backdrop-blur-xl cursor-zoom-out animate-in fade-in duration-200"
          onClick={() => setZoomed(false)}
        >
          <div 
            className="relative flex items-center justify-center w-full h-full max-w-[90vw] max-h-[90vh] sm:max-w-[70vw] sm:max-h-[70vh] p-8 sm:p-16 rounded-3xl border border-white/10 bg-black/20 shadow-2xl animate-in zoom-in-95 duration-300 cursor-default"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="absolute inset-0 bg-primary/10 rounded-3xl blur-3xl pointer-events-none" />
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 200 120"
              className="w-full h-full object-contain drop-shadow-[0_0_80px_rgba(203,166,247,0.3)] relative z-10 pointer-events-none"
            >
              {svgContent}
            </svg>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

/* ────────────────────────────────────────────────────────────
   Procedural Math Generators for the Textures & Debris
   ────────────────────────────────────────────────────────── */

// Glowing cubic chunks scattered inside the left ribbon
function FDMSquares() {
  const elements = useMemo(() => {
    let seed = 321;
    const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    const elems = [];
    
    // Concentrate within the left ribbon volume ([0, 100]x[10, 110])
    for (let i = 0; i < 60; i++) {
        const x = 5 + rnd() * 90;
        const y = 5 + rnd() * 110;
        const s = 2 + rnd() * 6;
        
        // Randomly color them with brand FDM palette
        const fill = rnd() > 0.5 ? "#89b4fa" : "#b4befe";
        
        elems.push(
            <rect 
              key={`s-${i}`} 
              x={x} y={y} 
              width={s} height={s} 
              fill={fill} 
              opacity={0.4 + rnd()*0.6} 
              transform={`rotate(15, ${x}, ${y})`} 
            />
        );
        
        // Crisp high-contrast stroke for aesthetic
        elems.push(
            <rect 
              key={`sw-${i}`} 
              x={x} y={y} 
              width={s} height={s} 
              fill="none"
              stroke="#ffffff"
              strokeWidth="0.4"
              opacity={0.7} 
              transform={`rotate(15, ${x}, ${y})`} 
            />
        );
    }
    return elems;
  }, []);
  
  return <>{elements}</>;
}

// Crisp Delaunay/Triangular lattice mapped across the right ribbon
function FEMWireframe({id}: {id: string}) {
  const elements = useMemo(() => {
    let seed = 123;
    const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    const elems = [];
    
    // Mesh covers the right lobe area [90, 200]
    const pts: [number, number][] = [];
    const step = 14;
    for (let x = 80; x <= 200; x += step) {
      for (let y = -10; y <= 130; y += step) {
        pts.push([x + (rnd() - 0.5) * 12, y + (rnd() - 0.5) * 12]);
      }
    }
    
    const cols = Math.floor(120 / step) + 1;
    const rows = Math.floor(140 / step) + 1;
    
    for (let c = 0; c < cols - 1; c++) {
      for (let r = 0; r < rows - 1; r++) {
         const p1 = pts[c * rows + r];
         const p2 = pts[(c + 1) * rows + r];
         const p3 = pts[c * rows + r + 1];
         const p4 = pts[(c + 1) * rows + r + 1];
         
         if (!p1 || !p2 || !p3 || !p4) continue;
         
         const isAlt = rnd() > 0.5;
         const lines = isAlt
            ? `M${p1[0]},${p1[1]} L${p2[0]},${p2[1]} L${p3[0]},${p3[1]} Z M${p2[0]},${p2[1]} L${p4[0]},${p4[1]} L${p3[0]},${p3[1]} Z`
            : `M${p1[0]},${p1[1]} L${p2[0]},${p2[1]} L${p4[0]},${p4[1]} Z M${p1[0]},${p1[1]} L${p4[0]},${p4[1]} L${p3[0]},${p3[1]} Z`;
         
         // Dark inset framework
         elems.push(<path key={`f-${c}-${r}`} d={lines} fill="none" stroke="#11111b" strokeWidth="1" opacity="0.6" />);
         // Bright glowing rim wireframe
         elems.push(<path key={`fw-${c}-${r}`} d={lines} fill="none" stroke="#ffffff" strokeWidth="0.4" opacity="0.5" />);
         
         // Randomly colored faceted glass faces
         if (rnd() > 0.6) {
             const t = isAlt ? `M${p1[0]},${p1[1]} L${p2[0]},${p2[1]} L${p3[0]},${p3[1]} Z` : `M${p1[0]},${p1[1]} L${p2[0]},${p2[1]} L${p4[0]},${p4[1]} Z`;
             const fill = rnd() > 0.5 ? "#f5c2e7" : "#cba6f7";
             elems.push(<path key={`ff-${c}-${r}`} d={t} fill={fill} opacity={0.3 + rnd() * 0.4} />);
         }
      }
    }
    return elems;
  }, []);
  
  return <>{elements}</>;
}

// External flying geometric fragments escaping from the infinite loop
function FloatingDebris() {
  const debris = useMemo(() => {
    let seed = 999;
    const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    const elements = [];
    
    // Left FDM debris flying out (cubes)
    for (let i = 0; i < 20; i++) {
        // Orbit roughly around the left center (50, 60)
        const a = rnd() * Math.PI * 2;
        const r = 35 + rnd() * 25;
        const x = 50 + Math.cos(a) * r;
        const y = 60 + Math.sin(a) * r;
        const size = 1.5 + rnd() * 3.5;
        elements.push(
            <rect 
                key={`dl-${i}`} x={x} y={y} width={size} height={size} 
                fill="#89b4fa" opacity={0.2 + rnd() * 0.6} 
                transform={`rotate(${rnd()*360}, ${x}, ${y})`} 
            />
        );
    }
    
    // Right FEM debris flying out (triangles)
    for (let i = 0; i < 20; i++) {
        // Orbit roughly around the right center (150, 60)
        const a = rnd() * Math.PI * 2;
        const r = 35 + rnd() * 25;
        const x = 150 + Math.cos(a) * r;
        const y = 60 + Math.sin(a) * r;
        const s = 2 + rnd() * 4;
        const d = `M${x},${y} L${x+s},${y+s} L${x},${y+s*1.5}Z`;
        elements.push(
            <path 
                key={`dr-${i}`} d={d} 
                fill="#f5c2e7" opacity={0.2 + rnd() * 0.6} 
                transform={`rotate(${rnd()*360}, ${x}, ${y})`} 
            />
        );
    }

    return elements;
  }, []);

  return <>{debris}</>;
}

/* ────────────────────────────────────────────────────────────
   Compact Mark Variant (for badges/icons without the text mark)
   ────────────────────────────────────────────────────────── */
export function FullmagMark({
  size = 32,
  className,
}: { size?: number; className?: string }) {
  return (
    <div
      className={cn("inline-flex items-center justify-center filter drop-shadow-md", className)}
      style={{ width: size, height: size }}
    >
      <FullmagLogo size={size * 1.5} />
    </div>
  );
}
