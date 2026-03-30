"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";

/* ── Types ─────────────────────────────────────────────────────────── */

export type NodeStatus = "ready" | "active" | "pending" | "error";

export interface TreeNodeData {
  id: string;
  label: string;
  icon?: string;
  badge?: string;
  status?: NodeStatus;
  children?: TreeNodeData[];
  onClick?: () => void;
}

interface ModelTreeProps {
  nodes: TreeNodeData[];
  activeId?: string | null;
  onNodeClick?: (id: string) => void;
  onContextAction?: (nodeId: string, action: string) => void;
  className?: string;
}

/* ── Tree Node ─────────────────────────────────────────────────────── */

function TreeNode({
  node,
  depth,
  activeId,
  onNodeClick,
  onContextMenu,
}: {
  node: TreeNodeData;
  depth: number;
  activeId?: string | null;
  onNodeClick?: (id: string) => void;
  onContextMenu?: (e: React.MouseEvent, nodeId: string, label: string) => void;
}) {
  const [open, setOpen] = useState(depth < 2);
  const hasChildren = node.children && node.children.length > 0;

  const handleClick = useCallback(() => {
    if (hasChildren) setOpen((prev) => !prev);
    node.onClick?.();
    onNodeClick?.(node.id);
  }, [hasChildren, node, onNodeClick]);

  return (
    <div className="flex flex-col">
      <div
        className={cn(
          "flex items-center gap-1.5 pr-2 py-1 my-[1px] cursor-pointer rounded-md transition-all min-h-[26px] relative overflow-hidden",
          activeId === node.id
            ? "bg-primary/10 text-primary font-semibold border border-primary/20 shadow-sm after:absolute after:left-0 after:top-0 after:bottom-0 after:w-[3px] after:bg-primary"
            : "hover:bg-muted/60 text-foreground border border-transparent"
        )}
        style={{ paddingLeft: `${Math.max(8, depth * 14 + 8)}px` }}
        onClick={handleClick}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onContextMenu?.(e, node.id, node.label); }}
        role="treeitem"
        aria-expanded={hasChildren ? open : undefined}
      >
        {hasChildren ? (
          <span 
            className={cn(
              "flex h-3.5 w-3.5 shrink-0 items-center justify-center text-muted-foreground transition-transform duration-150", 
              open && "rotate-90"
            )}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M3 1.5L7 5L3 8.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        ) : (
          <span className="flex h-3.5 w-3.5 shrink-0" />
        )}
        
        {node.icon && (
          <span className="flex h-4 w-4 shrink-0 items-center justify-center text-xs opacity-70">
            {node.icon}
          </span>
        )}
        
        <span className="flex-1 truncate font-medium text-sm">
          {node.label}
        </span>
        
        {node.status && (
          <span 
            className={cn(
              "h-1.5 w-1.5 shrink-0 rounded-full",
              node.status === "ready" ? "bg-emerald-500" :
              node.status === "active" ? "bg-primary" :
              node.status === "error" ? "bg-destructive" :
              "bg-muted-foreground"
            )} 
          />
        )}
        
        {node.badge && (
          <span className="shrink-0 rounded-full bg-muted px-1.5 py-[1px] text-[0.6rem] font-semibold text-muted-foreground font-mono">
            {node.badge}
          </span>
        )}
      </div>
      
      {hasChildren && open && (
        <div className="flex flex-col animate-in fade-in slide-in-from-top-1 duration-150" role="group">
          {node.children!.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              activeId={activeId}
              onNodeClick={onNodeClick}
              onContextMenu={onContextMenu}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ── ModelTree ──────────────────────────────────────────────────────── */

export default function ModelTree({
  nodes,
  activeId,
  onNodeClick,
  onContextAction,
  className,
}: ModelTreeProps) {
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; nodeId: string; label: string } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const handleContextMenu = useCallback((e: React.MouseEvent, nodeId: string, label: string) => {
    setCtxMenu({ x: e.clientX, y: e.clientY, nodeId, label });
  }, []);

  /* Close on click outside or Escape */
  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    if (menuRef.current) {
      menuRef.current.style.left = `${ctxMenu.x}px`;
      menuRef.current.style.top = `${ctxMenu.y}px`;
    }
    window.addEventListener("click", close);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("click", close); window.removeEventListener("keydown", onKey); };
  }, [ctxMenu]);

  const handleAction = useCallback((action: string) => {
    if (ctxMenu) {
      onContextAction?.(ctxMenu.nodeId, action);
      if (action === "select") onNodeClick?.(ctxMenu.nodeId);
      if (action === "copy-name" && ctxMenu.label) void navigator.clipboard.writeText(ctxMenu.label);
    }
    setCtxMenu(null);
  }, [ctxMenu, onContextAction, onNodeClick]);

  return (
    <div className={cn("flex flex-col gap-[1px] py-1 select-none", className)} role="tree">
      {nodes.map((node) => (
        <TreeNode
          key={node.id}
          node={node}
          depth={0}
          activeId={activeId}
          onNodeClick={onNodeClick}
          onContextMenu={handleContextMenu}
        />
      ))}

      {/* Context menu overlay */}
      {ctxMenu && (
        <div
          ref={menuRef}
          className="fixed z-[200] min-w-[160px] p-1 rounded-md bg-popover border border-border shadow-md animate-in fade-in zoom-in-95 duration-100"
        >
          <div className="px-2 py-1 text-[0.65rem] font-bold uppercase tracking-widest text-muted-foreground border-b border-border/50 mb-1">
            {ctxMenu.label}
          </div>
          <button className="w-full text-left px-2 py-1.5 text-xs font-medium rounded-sm hover:bg-muted text-popover-foreground transition-colors" onClick={() => handleAction("select")}>Select</button>
          <button className="w-full text-left px-2 py-1.5 text-xs font-medium rounded-sm hover:bg-muted text-popover-foreground transition-colors" onClick={() => handleAction("copy-name")}>Copy Name</button>
          <div className="h-px bg-border/50 my-1 mx-1" />
          <button className="w-full text-left px-2 py-1.5 text-xs font-medium rounded-sm hover:bg-muted text-popover-foreground transition-colors" onClick={() => handleAction("expand-all")}>Expand All</button>
          <button className="w-full text-left px-2 py-1.5 text-xs font-medium rounded-sm hover:bg-muted text-popover-foreground transition-colors" onClick={() => handleAction("collapse-all")}>Collapse All</button>
        </div>
      )}
    </div>
  );
}

/* ── Default model tree for Fullmag ───────────────────────────────── */

export function buildFullmagModelTree(opts: {
  backend?: string;
  geometryKind?: string;
  materialName?: string;
  materialMsat?: number | null;
  materialAex?: number | null;
  materialAlpha?: number | null;
  meshStatus?: NodeStatus;
  meshElements?: number;
  meshNodes?: number;
  meshFeOrder?: number | null;
  meshName?: string | null;
  solverStatus?: NodeStatus;
  solverIntegrator?: string;
  solverRelaxAlgorithm?: string;
  demagMethod?: string;
  physicsTerms?: string[];
  exchangeEnabled?: boolean;
  demagEnabled?: boolean;
  zeemanField?: number[] | null;
  convergenceStatus?: NodeStatus;
  scalarRowCount?: number;
  onGeometryClick?: () => void;
  onRegionsClick?: () => void;
  onMeshClick?: () => void;
  onMaterialClick?: () => void;
  onPhysicsClick?: () => void;
  onSolverClick?: () => void;
  onResultsClick?: () => void;
  initialStatePath?: string | null;
  initialStateFormat?: string | null;
}): TreeNodeData[] {
  const physicsChildren: TreeNodeData[] = [
    { id: "phys-llg", label: "LLG Dynamics", icon: "∂", status: "ready" },
    { 
      id: "phys-exchange", 
      label: "Exchange", 
      icon: "↔", 
      status: opts.exchangeEnabled === false ? "pending" : "ready",
      badge: opts.exchangeEnabled === false ? "disabled" : undefined
    },
    {
      id: "phys-demag",
      label: "Demagnetization",
      icon: "🧲",
      status: opts.demagEnabled === false ? "pending" : "ready",
      badge: opts.demagEnabled === false ? "disabled" : (opts.demagMethod ?? "transfer-grid"),
      children: [
        { id: "phys-demag-method", label: `Method: ${opts.demagMethod ?? "transfer-grid"}`, icon: "⚙" },
        { id: "phys-demag-open-bc", label: "Open boundary", icon: "∞" },
      ],
    },
    { 
      id: "phys-zeeman", 
      label: "Zeeman (external H)", 
      icon: "→", 
      status: opts.zeemanField ? "ready" : "pending",
      badge: opts.zeemanField ? undefined : "disabled" 
    },
    { id: "phys-bc", label: "Boundary Conditions", icon: "▢" },
  ];

  // Add optional physics terms
  if (opts.physicsTerms?.includes("thermal")) {
    physicsChildren.push({ id: "phys-thermal", label: "Thermal Noise", icon: "🌡", status: "pending" });
  }
  if (opts.physicsTerms?.includes("sot") || opts.physicsTerms?.includes("stt")) {
    physicsChildren.push({ id: "phys-spin-torque", label: "Spin Torque", icon: "⟳", status: "pending" });
  }

  return [
    {
      id: "geometry",
      label: "Geometry",
      icon: "🔷",
      badge: opts.geometryKind ?? "—",
      status: "ready",
      onClick: opts.onGeometryClick,
      children: [
        { id: "geo-body", label: opts.geometryKind ?? "Body", icon: "◻" },
      ],
    },
    {
      id: "regions",
      label: "Regions / Selections",
      icon: "▦",
      status: "ready",
      onClick: opts.onRegionsClick,
      children: [
        { id: "reg-domain", label: "Domain 1", icon: "■" },
        { id: "reg-boundary", label: "Boundary", icon: "▢" },
      ],
    },
    {
      id: "materials",
      label: "Materials",
      icon: "●",
      badge: opts.materialName ?? "—",
      status: opts.materialMsat != null ? "ready" : "pending",
      onClick: opts.onMaterialClick,
      children: [
        { id: "mat-body", label: opts.materialName ?? "Material 1", icon: "●",
          children: [
            { id: "mat-ms", label: opts.materialMsat != null ? `Ms = ${fmtCompact(opts.materialMsat)} A/m` : "Ms (saturation)", icon: "𝑀", status: opts.materialMsat != null ? "ready" : "pending" },
            { id: "mat-aex", label: opts.materialAex != null ? `A = ${opts.materialAex.toExponential(1)} J/m` : "A (exchange)", icon: "𝐴", status: opts.materialAex != null ? "ready" : "pending" },
            { id: "mat-alpha", label: opts.materialAlpha != null ? `α = ${opts.materialAlpha}` : "α (damping)", icon: "α", status: opts.materialAlpha != null ? "ready" : "pending" },
          ],
        },
        {
          id: "initial-state",
          label: "Initial State (m₀)",
          icon: "📂",
          status: opts.initialStatePath ? "ready" : "pending",
          badge: opts.initialStatePath
            ? (opts.initialStateFormat ?? "file")
            : "uniform",
        },
      ],
    },
    {
      id: "physics",
      label: "Physics",
      icon: "⚛",
      status: "ready",
      onClick: opts.onPhysicsClick,
      children: physicsChildren,
    },
    {
      id: "mesh",
      label: "Mesh",
      icon: "◫",
      badge: opts.meshElements ? `${opts.meshElements.toLocaleString()} el` : opts.meshNodes ? `${opts.meshNodes.toLocaleString()} nodes` : "—",
      status: opts.meshStatus ?? "pending",
      onClick: opts.onMeshClick,
      children: [
        { id: "mesh-size", label: opts.meshFeOrder != null ? `Order: P${opts.meshFeOrder}` : "Size", icon: "📏" },
        { id: "mesh-algorithm", label: "Algorithm", icon: "⚙" },
        { id: "mesh-quality", label: "Quality", icon: "📊" },
      ],
    },
    {
      id: "study",
      label: "Study",
      icon: "▶",
      badge: opts.backend ?? "—",
      status: opts.solverStatus ?? "pending",
      onClick: opts.onSolverClick,
      children: [
        { id: "study-solver", label: opts.solverIntegrator ? `Integrator: ${opts.solverIntegrator.toUpperCase()}` : "Solver Configuration", icon: "🔧" },
        { id: "study-time", label: "Time Stepping", icon: "⏱" },
        { id: "study-convergence", label: "Convergence", icon: "📉", status: opts.convergenceStatus },
      ],
    },
    {
      id: "results",
      label: "Results",
      icon: "📈",
      status: opts.scalarRowCount && opts.scalarRowCount > 0 ? "ready" : "pending",
      badge: opts.scalarRowCount ? `${opts.scalarRowCount} pts` : undefined,
      onClick: opts.onResultsClick,
      children: [
        { id: "res-fields", label: "Field Data", icon: "🗂" },
        { id: "res-energy", label: "Energy", icon: "⚡" },
        { id: "res-state-io", label: "State I/O", icon: "💾" },
        { id: "res-export", label: "Export", icon: "💾" },
      ],
    },
  ];
}

function fmtCompact(v: number): string {
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(0)}M`;
  if (Math.abs(v) >= 1e3) return `${(v / 1e3).toFixed(0)}k`;
  return v.toFixed(0);
}
