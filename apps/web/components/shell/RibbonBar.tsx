"use client";

import { useMemo } from "react";
import {
  FileText, Play, Pause, Square, Box, Columns2, Grid3X3,
  PanelRight, Camera, Download, BarChart3,
  Shapes, FlaskConical, Hexagon, Cog, Eye,
  RefreshCw, Ruler, ListChecks, Zap, Magnet, Target,
} from "lucide-react";
import {
  Tooltip, TooltipTrigger, TooltipContent, TooltipProvider,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/* ── Types ──────────────────────────────────────── */

interface RibbonAction {
  id: string;
  icon: React.ReactNode;
  label: string;
  tooltip?: string;
  shortcut?: string;
  disabled?: boolean;
  active?: boolean;
  accent?: boolean;
  action?: () => void;
}

interface RibbonGroup {
  id: string;
  title: string;
  actions: RibbonAction[];
}

type RibbonTab = "Home" | "Mesh" | "Study" | "Results";

interface RibbonBarProps {
  viewMode?: string;
  isFemBackend?: boolean;
  solverRunning?: boolean;
  sidebarVisible?: boolean;
  selectedNodeId?: string | null;
  canRun?: boolean;
  canRelax?: boolean;
  canPause?: boolean;
  canStop?: boolean;
  onViewChange?: (mode: string) => void;
  onSidebarToggle?: () => void;
  onSimAction?: (action: string) => void;
  onSetup?: () => void;
  onExport?: () => void;
  onCapture?: () => void;
}

/* ── Tab inference from tree node ── */
function inferTab(nodeId: string | null | undefined): RibbonTab {
  if (!nodeId) return "Home";
  if (nodeId.startsWith("mesh") || nodeId === "mesh") return "Mesh";
  if (nodeId.startsWith("study") || nodeId === "study") return "Study";
  if (nodeId.startsWith("res-") || nodeId === "results" ||
      nodeId.startsWith("phys-") || nodeId === "physics") return "Results";
  return "Home";
}

/* ── Group builders per tab ── */
function buildHomeGroups(p: RibbonBarProps): RibbonGroup[] {
  return [
    {
      id: "script", title: "Script",
      actions: [
        { id: "open", icon: <FileText size={20} />, label: "Open", tooltip: "Open script file", shortcut: "Ctrl+O", disabled: true },
        { id: "run", icon: <Play size={20} fill="currentColor" />, label: "Run", tooltip: "Run simulation", shortcut: "F5", accent: true, disabled: !p.canRun, action: () => p.onSimAction?.("run") },
      ],
    },
    {
      id: "model", title: "Model",
      actions: [
        { id: "geometry", icon: <Shapes size={20} />, label: "Geometry", tooltip: "Define geometry", disabled: true },
        { id: "material", icon: <FlaskConical size={20} />, label: "Material", tooltip: "Material properties", disabled: true },
        { id: "mesh", icon: <Hexagon size={20} />, label: "Mesh", tooltip: "Mesh / geometry view", active: p.viewMode === "Mesh", action: () => p.onViewChange?.("Mesh") },
      ],
    },
    {
      id: "solver", title: "Solver",
      actions: [
        { id: "configure", icon: <Cog size={20} />, label: "Setup", tooltip: "Configure time integrator, relaxation, and convergence", action: p.onSetup },
        { id: "relax", icon: <Target size={20} />, label: "Relax", tooltip: "Run relaxation to equilibrium", disabled: !p.canRelax, action: () => p.onSimAction?.("relax") },
        { id: "run-solve", icon: <Play size={20} fill="currentColor" />, label: "Run", tooltip: "Run until the configured stop time", accent: true, disabled: !p.canRun, action: () => p.onSimAction?.("run") },
        { id: "pause", icon: <Pause size={20} fill="currentColor" />, label: "Pause", tooltip: "Pause solver", disabled: !p.canPause, action: () => p.onSimAction?.("pause") },
        { id: "stop", icon: <Square size={20} fill="currentColor" />, label: "Stop", tooltip: "Stop solver", disabled: !p.canStop, action: () => p.onSimAction?.("stop") },
      ],
    },
    buildViewGroup(p),
  ];
}

function buildMeshGroups(p: RibbonBarProps): RibbonGroup[] {
  return [
    {
      id: "mesh-gen", title: "Generate",
      actions: [
        { id: "generate", icon: <RefreshCw size={20} />, label: "Generate", tooltip: "Re-generate mesh", accent: true, disabled: !p.isFemBackend },
        { id: "import", icon: <FileText size={20} />, label: "Import", tooltip: "Import mesh file", disabled: true },
      ],
    },
    {
      id: "mesh-quality", title: "Quality",
      actions: [
        { id: "quality", icon: <ListChecks size={20} />, label: "Quality", tooltip: "View mesh quality metrics", action: () => p.onViewChange?.("Mesh") },
        { id: "refine", icon: <Ruler size={20} />, label: "Refine", tooltip: "Adaptive mesh refinement", disabled: true },
      ],
    },
    {
      id: "mesh-export", title: "Export",
      actions: [
        { id: "export-vtk", icon: <Download size={20} />, label: "VTK", tooltip: "Export VTK mesh", action: p.onExport },
        { id: "snapshot", icon: <Camera size={20} />, label: "Capture", tooltip: "Take viewport screenshot", action: p.onCapture },
      ],
    },
    buildViewGroup(p),
  ];
}

function buildStudyGroups(p: RibbonBarProps): RibbonGroup[] {
  return [
    {
      id: "integrator", title: "Integrator",
      actions: [
        { id: "configure", icon: <Cog size={20} />, label: "Setup", tooltip: "Configure integrator and time-step settings", action: p.onSetup },
      ],
    },
    {
      id: "execution", title: "Execution",
      actions: [
        { id: "relax", icon: <Target size={20} />, label: "Relax", tooltip: "Run relaxation to equilibrium", disabled: !p.canRelax, action: () => p.onSimAction?.("relax") },
        { id: "run", icon: <Play size={20} fill="currentColor" />, label: "Run", tooltip: "Run until the configured stop time", shortcut: "F5", accent: true, disabled: !p.canRun, action: () => p.onSimAction?.("run") },
        { id: "pause", icon: <Pause size={20} fill="currentColor" />, label: "Pause", tooltip: "Pause solver", disabled: !p.canPause, action: () => p.onSimAction?.("pause") },
        { id: "stop", icon: <Square size={20} fill="currentColor" />, label: "Stop", tooltip: "Stop solver", disabled: !p.canStop, action: () => p.onSimAction?.("stop") },
      ],
    },
    buildViewGroup(p),
  ];
}

function buildResultsGroups(p: RibbonBarProps): RibbonGroup[] {
  return [
    {
      id: "quantity", title: "Quantity",
      actions: [
        { id: "magnetization", icon: <Magnet size={20} />, label: "M", tooltip: "Magnetization preview", active: true },
        { id: "exchange", icon: <Zap size={20} />, label: "H_ex", tooltip: "Exchange field preview" },
        { id: "demag", icon: <Shapes size={20} />, label: "H_dem", tooltip: "Demagnetization field preview" },
      ],
    },
    {
      id: "plot-tools", title: "Plot",
      actions: [
        { id: "plot", icon: <BarChart3 size={20} />, label: "Chart", tooltip: "Open scalar plot", action: () => p.onViewChange?.("charts") },
        { id: "snapshot", icon: <Camera size={20} />, label: "Capture", tooltip: "Take viewport screenshot", action: p.onCapture },
        { id: "exportvtk", icon: <Download size={20} />, label: "Export", tooltip: "Export VTK", action: p.onExport },
      ],
    },
    buildViewGroup(p),
  ];
}

function buildViewGroup(p: RibbonBarProps): RibbonGroup {
  return {
    id: "view", title: "View",
    actions: [
      { id: "3d", icon: <Box size={20} />, label: "3D", tooltip: "3D view", shortcut: "1", active: p.viewMode === "3D", action: () => p.onViewChange?.("3D") },
      { id: "2d", icon: <Columns2 size={20} />, label: "2D", tooltip: "2D view", shortcut: "2", active: p.viewMode === "2D", action: () => p.onViewChange?.("2D") },
      { id: "mesh-view", icon: <Grid3X3 size={20} />, label: "Mesh", tooltip: "Mesh view", shortcut: "3", active: p.viewMode === "Mesh", action: () => p.onViewChange?.("Mesh") },
      { id: "sidebar", icon: <PanelRight size={20} />, label: "Panel", tooltip: "Toggle sidebar", shortcut: "Ctrl+B", active: p.sidebarVisible, action: p.onSidebarToggle },
      { id: "eye", icon: <Eye size={20} />, label: "Focus", tooltip: "Focus mode", disabled: true },
    ],
  };
}

const TABS: RibbonTab[] = ["Home", "Mesh", "Study", "Results"];

/* ── Component ──────────────────────────────────── */

export default function RibbonBar(props: RibbonBarProps) {
  const inferredTab = inferTab(props.selectedNodeId);

  const groups = useMemo(() => {
    switch (inferredTab) {
      case "Mesh": return buildMeshGroups(props);
      case "Study": return buildStudyGroups(props);
      case "Results": return buildResultsGroups(props);
      default: return buildHomeGroups(props);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    inferredTab,
    props.viewMode,
    props.isFemBackend,
    props.solverRunning,
    props.sidebarVisible,
    props.canRun,
    props.canRelax,
    props.canPause,
    props.canStop,
  ]);

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex flex-col w-full border-b border-border/60 bg-gradient-to-br from-card/80 to-background/50 backdrop-blur-2xl shadow-[0_4px_24px_rgba(0,0,0,0.2)] shrink-0 z-30">
        {/* ── Tab row ── */}
        <div className="flex px-3 pt-2 gap-1 border-b border-border/20">
          {TABS.map((tab) => (
            <button
              key={tab}
              className={cn(
                "px-5 py-2 min-w-[80px] text-[0.65rem] font-bold uppercase tracking-[0.1em] transition-colors rounded-t-lg border-b-2",
                tab === inferredTab 
                  ? "border-primary bg-primary/10 text-primary" 
                  : "border-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground"
              )}
              disabled={tab !== inferredTab}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* ── Actions row ── */}
        <div className="flex items-stretch overflow-x-auto scrollbar-none py-2 px-2 gap-1 min-h-[96px]">
          {groups.map((group, gi) => (
            <div key={group.id} className="flex items-stretch shrink-0">
              {gi > 0 && <div className="w-px bg-border/40 mx-2 self-stretch my-3 shadow-[1px_0_0_hsla(0,0%,100%,0.02)]" />}
              <div className="flex flex-col justify-between items-center px-1 shrink-0">
                <div className="flex items-center gap-1">
                  {group.actions.map((action) => (
                    <Tooltip key={action.id}>
                      <TooltipTrigger asChild>
                        <button
                          className={cn(
                            "flex flex-col items-center justify-center rounded-md p-1 min-w-[60px] min-h-[56px] transition-all gap-1.5",
                            action.active ? "bg-primary/10 text-primary shadow-inner border border-primary/20" : 
                            action.accent ? "bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm border border-transparent" :
                            "text-foreground hover:bg-muted/80 border border-transparent hover:border-border/50",
                            action.disabled && "opacity-40 cursor-not-allowed pointer-events-none"
                          )}
                          disabled={action.disabled}
                          onClick={action.action}
                        >
                          <span className={cn(
                            "flex flex-col items-center", 
                            action.accent ? "text-primary-foreground" : action.active ? "text-primary" : "text-muted-foreground"
                          )}>
                            {action.icon}
                          </span>
                          <span className={cn(
                            "text-[0.65rem] font-bold leading-none tracking-tight",
                            action.accent ? "text-primary-foreground" : action.active ? "text-primary" : "text-foreground"
                          )}>
                            {action.label}
                          </span>
                        </button>
                      </TooltipTrigger>
                      {action.tooltip && (
                        <TooltipContent side="bottom" className="text-xs border border-border shadow-xl">
                          <span className="font-semibold">{action.tooltip}</span>
                          {action.shortcut && (
                            <kbd className="opacity-80 font-mono text-[10px] bg-muted px-1.5 py-0.5 rounded ml-2 border border-border">{action.shortcut}</kbd>
                          )}
                        </TooltipContent>
                      )}
                    </Tooltip>
                  ))}
                </div>
                <span className="text-[0.6rem] font-bold uppercase tracking-widest text-muted-foreground mt-2 opacity-60">
                  {group.title}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </TooltipProvider>
  );
}
