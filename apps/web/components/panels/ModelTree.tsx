"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import type {
  ModelBuilderGraphV2,
  ScriptBuilderCurrentModuleEntry,
  ScriptBuilderExcitationAnalysisEntry,
  ScriptBuilderGeometryEntry,
  ScriptBuilderMagnetizationEntry,
} from "@/lib/session/types";

/* ── Types ─────────────────────────────────────────────────────────── */

export type NodeStatus = "ready" | "active" | "pending" | "error";

export interface TreeNodeData {
  id: string;
  label: string;
  icon?: string;
  badge?: string;
  status?: NodeStatus;
  defaultOpen?: boolean;
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
  const [open, setOpen] = useState(node.defaultOpen ?? depth < 2);
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
          <button className="w-full text-left px-2 py-1.5 text-xs font-medium rounded-sm hover:bg-muted text-popover-foreground transition-colors" onClick={() => handleAction("focus")}>Focus in 3D</button>
          <button className="w-full text-left px-2 py-1.5 text-xs font-medium rounded-sm hover:bg-muted text-popover-foreground transition-colors" onClick={() => handleAction("copy-name")}>Copy Name</button>
          <div className="h-px bg-border/50 my-1 mx-1" />
          <button className="w-full text-left px-2 py-1.5 text-xs font-medium rounded-sm hover:bg-muted text-popover-foreground transition-colors" onClick={() => handleAction("expand-all")}>Expand All</button>
          <button className="w-full text-left px-2 py-1.5 text-xs font-medium rounded-sm hover:bg-muted text-popover-foreground transition-colors" onClick={() => handleAction("collapse-all")}>Collapse All</button>
        </div>
      )}
    </div>
  );
}

export function buildFullmagModelTree(opts: {
  graph?: ModelBuilderGraphV2 | null;
  studyLabel?: string | null;
  backend?: string;
  showUniverse?: boolean;
  universeMode?: string | null;
  universeDeclaredSize?: [number, number, number] | null;
  universeEffectiveSize?: [number, number, number] | null;
  universeCenter?: [number, number, number] | null;
  universePadding?: [number, number, number] | null;
  universeRole?: string | null;
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
  geometries?: ScriptBuilderGeometryEntry[];
  currentModules?: ScriptBuilderCurrentModuleEntry[];
  excitationAnalysis?: ScriptBuilderExcitationAnalysisEntry | null;
}): TreeNodeData[] {
  const graph = opts.graph ?? null;
  const graphUniverse = graph?.universe.value ?? null;
  const graphObjects =
    graph?.objects.items.map((objectNode) => ({
      id: `obj-${objectNode.id}`,
      name: objectNode.name,
      label: objectNode.label,
      geometry: objectNode.geometry,
      tree: objectNode.tree,
    })) ??
    [];
  const geos = graphObjects.map((objectNode) => objectNode.geometry).length > 0
    ? graphObjects.map((objectNode) => objectNode.geometry)
    : opts.geometries ?? [];
  const objects = graphObjects.length > 0
    ? graphObjects
    : geos.map((geometry) => ({
        id: `obj-${geometry.name}`,
        name: geometry.name,
        label: geometry.name,
        geometry,
        tree: {
          geometry: `geo-${geometry.name}`,
          material: `mat-${geometry.name}`,
          region: `reg-${geometry.name}`,
          mesh: `geo-${geometry.name}-mesh`,
        },
      }));
  const modules = graph?.current_modules.modules ?? opts.currentModules ?? [];
  const excitationAnalysis =
    graph?.current_modules.excitation_analysis ?? opts.excitationAnalysis ?? null;
  const initialState = graph?.study.initial_state ?? null;
  const showUniverse = Boolean(
    graphUniverse ||
      opts.showUniverse ||
      opts.universeDeclaredSize ||
      opts.universeEffectiveSize,
  );
  const universeMode = graphUniverse?.mode ?? opts.universeMode ?? null;
  const universeDeclaredSize = graphUniverse?.size ?? opts.universeDeclaredSize ?? null;
  const universeCenter = graphUniverse?.center ?? opts.universeCenter ?? null;
  const universePadding = graphUniverse?.padding ?? opts.universePadding ?? null;

  /* ── Physics ─────────────────────────────────────────────────────── */
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

  if (opts.physicsTerms?.includes("thermal")) {
    physicsChildren.push({ id: "phys-thermal", label: "Thermal Noise", icon: "🌡", status: "pending" });
  }
  if (opts.physicsTerms?.includes("sot") || opts.physicsTerms?.includes("stt")) {
    physicsChildren.push({ id: "phys-spin-torque", label: "Spin Torque", icon: "⟳", status: "pending" });
  }

  const objectsChildren: TreeNodeData[] =
    objects.length > 0
      ? objects.map((objectNode) => _buildObjectNode(objectNode))
      : [
          {
            id: "objects-empty",
            label: "No objects yet",
            icon: "◻",
            status: "pending",
          },
        ];

  const studyChildren: TreeNodeData[] = [];

  if (showUniverse) {
    studyChildren.push({
      id: "universe",
      label: "Universe",
      icon: "⬚",
      badge: universeMode ?? "derived",
      status: "ready",
      defaultOpen: true,
      children: _buildUniverseChildren({
        universeDeclaredSize,
        universeEffectiveSize: opts.universeEffectiveSize,
        universeCenter,
        universePadding,
        universeRole: opts.universeRole,
      }),
    });
  }

  studyChildren.push({
    id: "objects",
    label: "Objects",
    icon: "📦",
    badge: `${objects.length}`,
    status: objects.length > 0 ? "ready" : "pending",
    defaultOpen: true,
    onClick: opts.onGeometryClick,
    children: objectsChildren,
  });

  if (modules.length > 0 || excitationAnalysis) {
    const antennaChildren: TreeNodeData[] = modules.map((module) => ({
      id: `ant-${module.name}`,
      label: module.name,
      icon: module.antenna_kind === "CPWAntenna" ? "≋" : "▭",
      badge: `${module.antenna_kind === "CPWAntenna" ? "CPW" : "µstrip"} · ${(module.drive.current_a * 1e3).toFixed(1)} mA`,
      status: "ready" as const,
    }));
    if (excitationAnalysis) {
      antennaChildren.push({
        id: "ant-excitation",
        label: "Excitation Analysis",
        icon: "📡",
        badge: excitationAnalysis.method,
        status: "ready",
      });
    }
    studyChildren.push({
      id: "antennas",
      label: "Antennas / RF",
      icon: "📻",
      badge: `${modules.length} source${modules.length !== 1 ? "s" : ""}`,
      status: modules.length > 0 ? "ready" : "pending",
      defaultOpen: false,
      children: antennaChildren,
    });
  }

  studyChildren.push(
    {
      id: "physics",
      label: "Physics",
      icon: "⚛",
      status: "ready",
      defaultOpen: false,
      onClick: opts.onPhysicsClick,
      children: physicsChildren,
    },
    {
      id: "mesh",
      label: "Mesh Defaults",
      icon: "◫",
      badge: opts.meshElements ? `${opts.meshElements.toLocaleString()} el` : opts.meshNodes ? `${opts.meshNodes.toLocaleString()} nodes` : "—",
      status: opts.meshStatus ?? "pending",
      defaultOpen: false,
      onClick: opts.onMeshClick,
      children: [
        { id: "mesh-view", label: "Inspect View", icon: "👁" },
        { id: "mesh-size", label: opts.meshFeOrder != null ? `Order: P${opts.meshFeOrder}` : "Size", icon: "📏" },
        { id: "mesh-algorithm", label: "Algorithm", icon: "⚙" },
        { id: "mesh-quality", label: "Quality", icon: "📊" },
        { id: "mesh-pipeline", label: "Pipeline", icon: "🧭" },
      ],
    },
    {
      id: "study",
      label: "Study",
      icon: "▶",
      badge: opts.backend ?? "—",
      status: opts.solverStatus ?? "pending",
      defaultOpen: false,
      onClick: opts.onSolverClick,
      children: [
        { id: "study-solver", label: opts.solverIntegrator ? `Integrator: ${opts.solverIntegrator.toUpperCase()}` : "Solver Configuration", icon: "🔧" },
        { id: "study-time", label: "Time Stepping", icon: "⏱" },
        { id: "study-convergence", label: "Convergence", icon: "📉", status: opts.convergenceStatus },
      ],
    },
    {
      id: "results",
      label: "Outputs",
      icon: "📈",
      status: opts.scalarRowCount && opts.scalarRowCount > 0 ? "ready" : "pending",
      badge: opts.scalarRowCount ? `${opts.scalarRowCount} pts` : undefined,
      defaultOpen: false,
      onClick: opts.onResultsClick,
      children: [
        { id: "res-fields", label: "Field Data", icon: "🗂" },
        { id: "res-energy", label: "Energy", icon: "⚡" },
        { id: "res-state-io", label: "State I/O", icon: "💾" },
        { id: "res-export", label: "Export", icon: "💾" },
      ],
    },
  );

  return [
    {
      id: "study-root",
      label: opts.studyLabel ?? "Study",
      icon: "◈",
      badge: opts.backend ?? undefined,
      status: "ready",
      defaultOpen: true,
      children: studyChildren,
    },
  ];
}

function fmtCompact(v: number): string {
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(0)}M`;
  if (Math.abs(v) >= 1e3) return `${(v / 1e3).toFixed(0)}k`;
  return v.toFixed(0);
}

function fmtLength(value: number): string {
  const abs = Math.abs(value);
  if (!Number.isFinite(value)) return "—";
  if (abs >= 1e-3) return `${(value * 1e3).toFixed(2)} mm`;
  if (abs >= 1e-6) return `${(value * 1e6).toFixed(2)} µm`;
  return `${(value * 1e9).toFixed(1)} nm`;
}

function fmtVec(value: [number, number, number] | null | undefined): string {
  if (!value) return "—";
  return value.map((component) => fmtLength(component)).join(" · ");
}

function hasNonZeroVec(value: [number, number, number] | null | undefined): boolean {
  return Boolean(value && value.some((component) => Math.abs(component) > 0));
}

function _buildUniverseChildren(opts: {
  universeDeclaredSize?: [number, number, number] | null;
  universeEffectiveSize?: [number, number, number] | null;
  universeCenter?: [number, number, number] | null;
  universePadding?: [number, number, number] | null;
  universeRole?: string | null;
}): TreeNodeData[] {
  const children: TreeNodeData[] = [];
  const effectiveSize = opts.universeEffectiveSize ?? null;
  const declaredSize = opts.universeDeclaredSize ?? null;

  if (effectiveSize) {
    children.push({
      id: "universe-effective-size",
      label: `Effective extent: ${fmtVec(effectiveSize)}`,
      icon: "📏",
    });
  }
  if (declaredSize) {
    children.push({
      id: "universe-size",
      label: `Declared size: ${fmtVec(declaredSize)}`,
      icon: "◫",
    });
  }
  if (opts.universeCenter) {
    children.push({
      id: "universe-center",
      label: `Center: ${fmtVec(opts.universeCenter)}`,
      icon: "⌖",
    });
  }
  if (hasNonZeroVec(opts.universePadding)) {
    children.push({
      id: "universe-padding",
      label: `Padding: ${fmtVec(opts.universePadding)}`,
      icon: "↔",
    });
  }
  if (opts.universeRole) {
    children.push({
      id: "universe-role",
      label: opts.universeRole,
      icon: "⚙",
    });
  }
  return children;
}

/* ── Per-geometry node builders ───────────────────────────────────── */

const GEOMETRY_ICONS: Record<string, string> = {
  Box: "◻",
  Cylinder: "⬡",
  Ellipsoid: "⬭",
  Ellipse: "◯",
  ImportedGeometry: "📦",
  Difference: "✂",
  Union: "∪",
  Intersection: "∩",
};

function _buildGeometryNode(
  geo: ScriptBuilderGeometryEntry,
): TreeNodeData {
  const geoId = `geo-${geo.name}`;
  const icon = GEOMETRY_ICONS[geo.geometry_kind] ?? "◻";

  const meshNode: TreeNodeData = {
    id: `${geoId}-mesh`,
    label: "Mesh",
    icon: "◫",
    status: geo.mesh?.mode === "custom" ? "ready" : "pending",
    badge:
      geo.mesh?.mode === "custom"
        ? (geo.mesh.order ? `P${geo.mesh.order}` : "custom")
        : "inherit",
    children: [
      {
        id: `${geoId}-mesh-mode`,
        label: geo.mesh?.mode === "custom" ? "Mode: custom override" : "Mode: inherit global",
        icon: "⇆",
      },
      {
        id: `${geoId}-mesh-hmax`,
        label:
          geo.mesh?.mode === "custom" && geo.mesh.hmax
            ? `hmax = ${geo.mesh.hmax}`
            : "hmax from study defaults",
        icon: "📏",
      },
      ...(geo.mesh?.mode === "custom" && geo.mesh.source
        ? [{ id: `${geoId}-mesh-source`, label: geo.mesh.source, icon: "📄" } satisfies TreeNodeData]
        : []),
    ],
  };

  return {
    id: geoId,
    label: geo.name,
    icon,
    badge: geo.geometry_kind,
    status: "ready",
    children: [
      {
        id: `${geoId}-params`,
        label: "Properties",
        icon: "⚙",
        children: _buildGeometryParamChildren(geoId, geo),
      },
      _buildMaterialNode(geo),
      meshNode,
    ],
  };
}

function _buildObjectNode(objectNode: {
  id: string;
  name: string;
  label: string;
  geometry: ScriptBuilderGeometryEntry;
  tree: {
    geometry: string;
    material: string;
    region: string;
    mesh: string;
  };
}): TreeNodeData {
  const geo = objectNode.geometry;
  const geometryId = objectNode.tree.geometry;
  const materialId = objectNode.tree.material;
  const regionId = objectNode.tree.region;
  const meshId = objectNode.tree.mesh;

  const geometryChildren = _buildGeometryParamChildren(geometryId, geo);
  const meshNode: TreeNodeData = {
    id: meshId,
    label: "Mesh",
    icon: "◫",
    status: geo.mesh?.mode === "custom" ? "ready" : "pending",
    badge:
      geo.mesh?.mode === "custom"
        ? (geo.mesh.order ? `P${geo.mesh.order}` : "custom")
        : "inherit",
    children: [
      {
        id: `${meshId}-mode`,
        label: geo.mesh?.mode === "custom" ? "Mode: custom override" : "Mode: inherit global",
        icon: "⇆",
      },
      {
        id: `${meshId}-hmax`,
        label:
          geo.mesh?.mode === "custom" && geo.mesh.hmax
            ? `hmax = ${geo.mesh.hmax}`
            : "hmax from study defaults",
        icon: "📏",
      },
      ...(geo.mesh?.mode === "custom" && geo.mesh.source
        ? [{ id: `${meshId}-source`, label: geo.mesh.source, icon: "📄" } satisfies TreeNodeData]
        : []),
    ],
  };

  return {
    id: objectNode.id,
    label: objectNode.label,
    icon: GEOMETRY_ICONS[geo.geometry_kind] ?? "📦",
    badge: geo.geometry_kind,
    status: "ready",
    defaultOpen: true,
    children: [
      {
        id: geometryId,
        label: "Geometry",
        icon: "🔷",
        status: "ready",
        children: geometryChildren,
      },
      _buildRegionNode(geo, regionId),
      _buildMaterialNode(geo, materialId),
      meshNode,
    ],
  };
}

function _buildGeometryParamChildren(
  parentId: string,
  geo: ScriptBuilderGeometryEntry,
): TreeNodeData[] {
  const params = geo.geometry_params;
  const children: TreeNodeData[] = [];

  children.push({
    id: `${parentId}-kind`,
    label: geo.geometry_kind,
    icon: GEOMETRY_ICONS[geo.geometry_kind] ?? "⚙",
  });

  if (geo.geometry_kind === "Box" && Array.isArray(params.size)) {
    const [dx, dy, dz] = (params.size as number[]).map((v) => (v * 1e9).toFixed(1));
    children.push({ id: `${parentId}-size`, label: `Size: ${dx} × ${dy} × ${dz} nm`, icon: "📏" });
  } else if (geo.geometry_kind === "Cylinder") {
    const r = params.radius != null ? `r=${((params.radius as number) * 1e9).toFixed(1)}` : "";
    const h = params.height != null ? `h=${((params.height as number) * 1e9).toFixed(1)}` : "";
    children.push({ id: `${parentId}-dim`, label: `Dimensions: ${r} ${h} nm`, icon: "📏" });
  } else if (geo.geometry_kind === "Ellipsoid") {
    const rx = params.rx != null ? ((params.rx as number) * 1e9).toFixed(1) : "?";
    const ry = params.ry != null ? ((params.ry as number) * 1e9).toFixed(1) : "?";
    const rz = params.rz != null ? ((params.rz as number) * 1e9).toFixed(1) : "?";
    children.push({ id: `${parentId}-dim`, label: `Dimensions: ${rx} × ${ry} × ${rz} nm`, icon: "📏" });
  } else if (geo.geometry_kind === "Ellipse") {
    const rx = params.rx != null ? ((params.rx as number) * 1e9).toFixed(1) : "?";
    const ry = params.ry != null ? ((params.ry as number) * 1e9).toFixed(1) : "?";
    const height = params.height != null ? ((params.height as number) * 1e9).toFixed(1) : "?";
    children.push({ id: `${parentId}-dim`, label: `Dimensions: ${rx} × ${ry} × ${height} nm`, icon: "📏" });
  } else if (geo.geometry_kind === "ImportedGeometry" && typeof params.source === "string") {
    const basename = (params.source as string).split("/").pop() ?? params.source;
    children.push({ id: `${parentId}-source`, label: `Source: ${basename as string}`, icon: "📄" });
    if (params.volume === "surface") {
      children.push({ id: `${parentId}-volume`, label: "Volume: surface", icon: "◌" });
    }
  } else if (geo.geometry_kind === "Difference") {
    children.push({ id: `${parentId}-csg`, label: "CSG difference", icon: "✂" });
  } else if (geo.geometry_kind === "Union") {
    children.push({ id: `${parentId}-csg`, label: "CSG union", icon: "∪" });
  } else if (geo.geometry_kind === "Intersection") {
    children.push({ id: `${parentId}-csg`, label: "CSG intersection", icon: "∩" });
  }

  const translation = Array.isArray(params.translation)
    ? params.translation
    : Array.isArray(params.translate)
      ? params.translate
      : null;
  if (translation && translation.some((value) => Math.abs(Number(value)) > 0)) {
    children.push({
      id: `${parentId}-translation`,
      label: `Translate: ${translation.map((value) => `${(Number(value) * 1e9).toFixed(1)} nm`).join(" · ")}`,
      icon: "↔",
    });
  }

  if (geo.bounds_min && geo.bounds_max) {
    children.push({
      id: `${parentId}-bounds`,
      label: `Bounds: ${fmtVec([
        geo.bounds_max[0] - geo.bounds_min[0],
        geo.bounds_max[1] - geo.bounds_min[1],
        geo.bounds_max[2] - geo.bounds_min[2],
      ])}`,
      icon: "⌗",
    });
  }

  return children;
}

function _buildRegionNode(
  geo: ScriptBuilderGeometryEntry,
  regionId: string,
): TreeNodeData {
  const regionName = geo.region_name?.trim() || geo.name;
  return {
    id: regionId,
    label: "Regions",
    icon: "▣",
    status: "ready",
    children: [
      {
        id: `${regionId}-item`,
        label: regionName,
        icon: "◫",
        badge: geo.magnetization.kind,
        status: "ready",
        children: [
          {
            id: `${regionId}-texture`,
            label: `m₀: ${_magnetizationLabel(geo.magnetization)}`,
            icon: "🧭",
            status: "ready",
          },
        ],
      },
    ],
  };
}

function _buildMaterialNode(
  geo: ScriptBuilderGeometryEntry,
  materialId = `mat-${geo.name}`,
): TreeNodeData {
  const mat = geo.material;
  const mag = geo.magnetization;

  const matChildren: TreeNodeData[] = [
    {
      id: `${materialId}-ms`,
      label: mat.Ms != null ? `Ms = ${fmtCompact(mat.Ms)} A/m` : "Ms (saturation)",
      icon: "𝑀",
      status: mat.Ms != null ? "ready" : "pending",
    },
    {
      id: `${materialId}-aex`,
      label: mat.Aex != null ? `A = ${mat.Aex.toExponential(1)} J/m` : "A (exchange)",
      icon: "𝐴",
      status: mat.Aex != null ? "ready" : "pending",
    },
    {
      id: `${materialId}-alpha`,
      label: `α = ${mat.alpha}`,
      icon: "α",
      status: "ready",
    },
  ];

  if (mat.Dind != null) {
    matChildren.push({
      id: `${materialId}-dind`,
      label: `Dind = ${mat.Dind.toExponential(1)} J/m²`,
      icon: "𝐷",
      status: "ready",
    });
  }

  // Magnetization node
  const magLabel = _magnetizationLabel(mag);
  matChildren.push({
    id: `${materialId}-m0`,
    label: `m₀: ${magLabel}`,
    icon: "🧭",
    status: "ready",
    badge: mag.kind,
  });

  return {
    id: materialId,
    label: "Material & State",
    icon: "●",
    status: mat.Ms != null ? "ready" : "pending",
    children: matChildren,
  };
}

function _magnetizationLabel(
  mag: ScriptBuilderMagnetizationEntry,
): string {
  if (mag.kind === "uniform" && mag.value) {
    return `(${mag.value.map((v) => v.toFixed(2)).join(", ")})`;
  }
  if (mag.kind === "random") {
    return mag.seed != null ? `random(seed=${mag.seed})` : "random";
  }
  if (mag.kind === "file" && mag.source_path) {
    const basename = mag.source_path.split("/").pop() ?? mag.source_path;
    return basename;
  }
  return mag.kind;
}
