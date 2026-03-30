"use client";

import { cn } from "@/lib/utils";
import React, { useMemo } from "react";

/* ────────────────────────────────────────────────────────────
   FullmagLogo — High-Fidelity Volumetric Vector Mark

   Design: 
   - Left Lobe (FDM): 3D isometric voxel clusters
   - Right Lobe (FEM): Faceted, shattered glass Delaunay mesh
   - Center: Singularity high-intensity glow
   - Style: Catppuccin Mocha glassmorphism with specular highlights
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
  const [zoomed, setZoomed] = React.useState(false);
  const id = `fml-${Math.random().toString(36).substr(2, 5)}`; // Unique ID for safe multiple rendering

  const svgContent = (
    <>
      <defs>
        {/* -- Advanced Gradients -- */}
        <linearGradient id={`${id}-blue-grad`} x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#89b4fa" stopOpacity="0.8" />
          <stop offset="50%" stopColor="#1e1e2e" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#89b4fa" stopOpacity="0.9" />
        </linearGradient>

        <linearGradient id={`${id}-purple-grad`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#f5c2e7" stopOpacity="0.9" />
          <stop offset="50%" stopColor="#1e1e2e" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#cba6f7" stopOpacity="0.8" />
        </linearGradient>

        <radialGradient id={`${id}-core-glow`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="1" />
          <stop offset="20%" stopColor="#b4befe" stopOpacity="0.8" />
          <stop offset="50%" stopColor="#cba6f7" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#1e1e2e" stopOpacity="0" />
        </radialGradient>

        {/* -- Base Volumetric Teardrop Paths -- */}
        <path id={`${id}-left-lobe`} d="M100,55 C100,20 65,-5 35,10 C10,25 0,55 10,85 C20,115 65,125 100,65Z" />
        <path id={`${id}-right-lobe`} d="M100,55 C100,20 135,-5 165,10 C190,25 200,55 190,85 C180,115 135,125 100,65Z" />

        {/* -- Filters for Glassmorphism & Specular Bloom -- */}
        <filter id={`${id}-glass-blur`} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="4" />
        </filter>
        <filter id={`${id}-glow-blur`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="12" />
        </filter>
        <filter id={`${id}-specular`}>
          <feGaussianBlur stdDeviation="0.8" />
        </filter>
        <filter id={`${id}-pulse`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="5">
            <animate attributeName="stdDeviation" values="3;7;3" dur="3s" repeatCount="indefinite" />
          </feGaussianBlur>
        </filter>
      </defs>

      {/* ── Ambient Backdrop Glow ── */}
      <ellipse cx="100" cy="60" rx="85" ry="45" fill="#cba6f7" opacity="0.15" filter={`url(#${id}-glow-blur)`} />

      {/* ── LEFT LOBE (FDM) ── */}
      <g>
        {/* Deep inner shadow (3D Volume Base) */}
        <use href={`#${id}-left-lobe`} fill="#11111b" opacity="0.8" transform="translate(4, 5)" filter={`url(#${id}-glass-blur)`} />
        {/* Core Glass Surface */}
        <use href={`#${id}-left-lobe`} fill={`url(#${id}-blue-grad)`} />
        
        {/* Isometric FDM Voxels trapped inside */}
        <clipPath id={`${id}-clip-left-lobe`}>
          <use href={`#${id}-left-lobe`} />
        </clipPath>
        <g clipPath={`url(#${id}-clip-left-lobe)`}>
           <FDMCubes />
        </g>
        
        {/* Inner Glare / Specular Edge */}
        <use href={`#${id}-left-lobe`} stroke="#ffffff" strokeWidth="2" fill="none" opacity="0.6" filter={`url(#${id}-specular)`} transform="translate(1, -1)" />
        {/* Outer Ribbon Edge */}
        <use href={`#${id}-left-lobe`} stroke="#89b4fa" strokeWidth="4" fill="none" opacity="0.4" />
      </g>

      {/* ── RIGHT LOBE (FEM) ── */}
      <g>
        {/* Deep inner shadow (3D Volume Base) */}
        <use href={`#${id}-right-lobe`} fill="#11111b" opacity="0.8" transform="translate(-4, 5)" filter={`url(#${id}-glass-blur)`} />
        {/* Core Glass Surface */}
        <use href={`#${id}-right-lobe`} fill={`url(#${id}-purple-grad)`} />
        
        {/* Shattered FEM Facets trapped inside */}
        <clipPath id={`${id}-clip-right-lobe`}>
          <use href={`#${id}-right-lobe`} />
        </clipPath>
        <g clipPath={`url(#${id}-clip-right-lobe)`}>
           <FEMShards />
        </g>
        
        {/* Inner Glare / Specular Edge */}
        <use href={`#${id}-right-lobe`} stroke="#ffffff" strokeWidth="2" fill="none" opacity="0.6" filter={`url(#${id}-specular)`} transform="translate(-1, -1)" />
        {/* Outer Ribbon Edge */}
        <use href={`#${id}-right-lobe`} stroke="#cba6f7" strokeWidth="4" fill="none" opacity="0.4" />
      </g>

      {/* ── FLOATING DEBRIS (Sparks & Fragments) ── */}
      <FloatingDebris />

      {/* ── CENTER SINGULARITY (Fusion Point) ── */}
      <circle cx="100" cy="62" r="30" fill={`url(#${id}-core-glow)`} filter={(animate || zoomed) ? `url(#${id}-pulse)` : undefined} />
      <circle cx="100" cy="62" r="6" fill="#ffffff" filter={`url(#${id}-specular)`} />
      
      {/* ── Animated Outer Pulse (for loading) ── */}
      {(animate || zoomed) && (
        <circle cx="100" cy="62" r="40" fill="none" stroke="#f5c2e7" strokeWidth="1" opacity="0">
          <animate attributeName="r" values="30;80" dur="2s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.6;0" dur="2s" repeatCount="indefinite" />
        </circle>
      )}
    </>
  );

  return (
    <>
      {/* Render the standard sized logo inline */}
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
        aria-label="Fullmag Volumetric Logo"
      >
        {svgContent}
      </svg>

      {/* Temporarily render modal overlay when clicked */}
      {zoomed && (
        <div 
          className="fixed inset-0 z-[99999] p-8 flex items-center justify-center bg-background/90 backdrop-blur-xl cursor-zoom-out animate-in fade-in duration-200"
          onClick={() => setZoomed(false)}
        >
          <div 
            className="relative flex items-center justify-center w-full max-w-[50vw] p-16 rounded-3xl border border-white/10 bg-black/20 shadow-2xl animate-in zoom-in-95 duration-300 cursor-default"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Glow behind the logo matching the palette */}
            <div className="absolute inset-0 bg-primary/10 rounded-3xl blur-3xl pointer-events-none" />
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 200 120"
              className="w-full h-auto drop-shadow-[0_0_80px_rgba(203,166,247,0.3)] relative z-10 pointer-events-none"
            >
              {svgContent}
            </svg>
          </div>
        </div>
      )}
    </>
  );
}

/* ────────────────────────────────────────────────────────────
   Procedural 3D SVG Generators
   ────────────────────────────────────────────────────────── */

// Calculates static isometric 3D cubes packed into the FDM lobe
function FDMCubes() {
  const cubes = useMemo(() => {
    let seed = 14;
    const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    const elements = [];
    
    // Draw 180 cubes dynamically placed
    for (let i = 0; i < 180; i++) {
        const x = 5 + rnd() * 95;
        const y = 5 + rnd() * 110;
        
        // Cubes get smaller & denser towards the singularity
        const distToCenter = Math.sqrt(Math.pow(x - 100, 2) + Math.pow(y - 60, 2));
        const sizeMultiplier = distToCenter < 30 ? 0.5 : (distToCenter < 60 ? 1 : 1.5);
        const size = (2 + rnd() * 5) * sizeMultiplier;
      
        const h = size * 0.866; 
        const hw = size / 2;
      
        // Isometric 3D projection paths
        const pTop = `M${x},${y-size} L${x+hw},${y-h} L${x},${y} L${x-hw},${y-h}Z`;
        const pLeft = `M${x},${y} L${x-hw},${y-h} L${x-hw},${y+h} L${x},${y+size}Z`;
        const pRight = `M${x},${y} L${x+hw},${y-h} L${x+hw},${y+h} L${x},${y+size}Z`;
      
        // Randomize brightness for depth illusion
        const baseOpacity = distToCenter < 40 ? 0.3 + rnd() * 0.4 : 0.6 + rnd() * 0.4;
      
        elements.push(
            <g key={i} opacity={baseOpacity}>
                <path d={pTop} fill="#f5c2e7" opacity="0.9" />   {/* Highlight / Top */}
                <path d={pLeft} fill="#89b4fa" opacity="0.8" />  {/* Mids / Left */}
                <path d={pRight} fill="#313244" opacity="0.7" /> {/* Shadow / Right */}
                {/* Thin sharp edges */}
                <path d={pTop} fill="none" stroke="#ffffff" strokeWidth="0.2" opacity="0.8" />
            </g>
        );
    }
    return elements;
  }, []);

  return <>{cubes}</>;
}

// Calculates dynamic filled Voronoi/Delaunay-style shards for the FEM lobe
function FEMShards() {
  const shards = useMemo(() => {
    let seed = 42;
    const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    
    // Generate grid points with heavy jitter
    const pts: [number, number][] = [];
    const step = 12;
    for (let x = 90; x <= 210; x += step) {
      for (let y = -10; y <= 130; y += step) {
        pts.push([x + (rnd() - 0.5) * 16, y + (rnd() - 0.5) * 16]);
      }
    }

    const cols = Math.floor(120 / step) + 1;
    const rows = Math.floor(140 / step) + 1;
    const elements = [];
    
    const colors = ["#cba6f7", "#b4befe", "#f5c2e7", "#89b4fa", "#1e1e2e"];
    
    for (let c = 0; c < cols - 1; c++) {
      for (let r = 0; r < rows - 1; r++) {
        const p1 = pts[c * rows + r];
        const p2 = pts[(c + 1) * rows + r];
        const p3 = pts[c * rows + r + 1];
        const p4 = pts[(c + 1) * rows + r + 1];
        
        if (!p1 || !p2 || !p3 || !p4) continue;

        const colorIndex1 = Math.floor(rnd() * colors.length);
        const colorIndex2 = Math.floor(rnd() * colors.length);
        const op = 0.4 + rnd() * 0.5;

        // Triangulate
        if (rnd() > 0.5) {
          const t1 = `M${p1[0]},${p1[1]} L${p2[0]},${p2[1]} L${p3[0]},${p3[1]}Z`;
          const t2 = `M${p2[0]},${p2[1]} L${p4[0]},${p4[1]} L${p3[0]},${p3[1]}Z`;
          elements.push(<path key={`t1-${c}-${r}`} d={t1} fill={colors[colorIndex1]} fillOpacity={op} stroke="#ffffff" strokeWidth="0.4" strokeOpacity="0.5" />);
          elements.push(<path key={`t2-${c}-${r}`} d={t2} fill={colors[colorIndex2]} fillOpacity={op} stroke="#ffffff" strokeWidth="0.4" strokeOpacity="0.5" />);
        } else {
          const t3 = `M${p1[0]},${p1[1]} L${p2[0]},${p2[1]} L${p4[0]},${p4[1]}Z`;
          const t4 = `M${p1[0]},${p1[1]} L${p4[0]},${p4[1]} L${p3[0]},${p3[1]}Z`;
          elements.push(<path key={`t3-${c}-${r}`} d={t3} fill={colors[colorIndex1]} fillOpacity={op} stroke="#ffffff" strokeWidth="0.4" strokeOpacity="0.5" />);
          elements.push(<path key={`t4-${c}-${r}`} d={t4} fill={colors[colorIndex2]} fillOpacity={op} stroke="#ffffff" strokeWidth="0.4" strokeOpacity="0.5" />);
        }
      }
    }
    return elements;
  }, []);
  
  return <>{shards}</>;
}

// Sparkles / Stray voxels drifting away from the core
function FloatingDebris() {
  const debris = useMemo(() => {
    let seed = 999;
    const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    const elements = [];
    
    // Left FDM debris flying out (squares)
    for (let i = 0; i < 25; i++) {
        const x = rnd() * 80;
        const y = rnd() * 120;
        const size = 1 + rnd() * 4;
        elements.push(
            <rect 
                key={`dl-${i}`} x={x} y={y} width={size} height={size} 
                fill="#89b4fa" opacity={0.3 + rnd() * 0.7} 
                transform={`rotate(${rnd()*360}, ${x}, ${y})`} 
            />
        );
    }
    
    // Right FEM debris (shards)
    for (let i = 0; i < 25; i++) {
        const x = 120 + rnd() * 80;
        const y = rnd() * 120;
        const s = 1.5 + rnd() * 5;
        const d = `M${x},${y} L${x+s},${y+s} L${x},${y+s*1.5}Z`;
        elements.push(
            <path 
                key={`dr-${i}`} d={d} 
                fill="#f5c2e7" opacity={0.3 + rnd() * 0.7} 
                transform={`rotate(${rnd()*360}, ${x}, ${y})`} 
            />
        );
    }

    return elements;
  }, []);

  return <>{debris}</>;
}

/* ────────────────────────────────────────────────────────────
   Compact Mark Variant
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
