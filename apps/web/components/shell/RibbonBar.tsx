"use client";

import React, { useMemo, useState, useEffect } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  FileText, Play, Pause, Square, Box, Columns2, Grid3X3,
  PanelRight, Camera, Download, BarChart3,
  Shapes, FlaskConical, Hexagon, Cog, Eye,
  RefreshCw, Ruler, ListChecks, Zap, Magnet, Target, Save, Plus, RadioTower,
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
  iconColor?: string;
  action?: () => void;
  menuItems?: RibbonMenuItem[];
}

interface RibbonMenuItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  description?: string;
  disabled?: boolean;
  active?: boolean;
  separator?: boolean;
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
  runAction?: string;
  runLabel?: string;
  onViewChange?: (mode: string) => void;
  onSidebarToggle?: () => void;
  onSimAction?: (action: string) => void;
  quickPreviewTargets?: Array<{
    id: string;
    shortLabel: string;
    available: boolean;
  }>;
  selectedQuantity?: string;
  previewPending?: boolean;
  onQuickPreviewSelect?: (quantityId: string) => void;
  onExport?: () => void;
  onCapture?: () => void;
  onStateExport?: () => void;
  antennaSources?: Array<{
    name: string;
    kind: string;
    currentA: number;
  }>;
  selectedAntennaName?: string | null;
  onAddAntenna?: (kind: "MicrostripAntenna" | "CPWAntenna") => void;
  onSelectModelNode?: (nodeId: string) => void;
  meshGenerating?: boolean;
  onGenerateMesh?: () => void;
  selectedObjectId?: string | null;
  onRequestObjectFocus?: (objectId: string) => void;
}

/* ── Tab inference from tree node ── */
function inferTab(nodeId: string | null | undefined): RibbonTab {
  if (!nodeId) return "Home";
  if (nodeId === "universe-mesh" || nodeId.startsWith("universe-mesh-")) return "Mesh";
  if (nodeId.startsWith("mesh") || nodeId === "mesh") return "Mesh";
  // Per-object mesh nodes (e.g. "geo-nanoflower-mesh") → Mesh tab
  if (nodeId.startsWith("geo-") && nodeId.endsWith("-mesh")) return "Mesh";
  if (nodeId.startsWith("study") || nodeId === "study") return "Study";
  if (nodeId.startsWith("res-") || nodeId === "results" ||
      nodeId.startsWith("phys-") || nodeId === "physics") return "Results";
  return "Home";
}

/* ── Group builders per tab ── */
function buildHomeGroups(p: RibbonBarProps): RibbonGroup[] {
  const antennaMenuItems: RibbonMenuItem[] = [
    {
      id: "manage-antennas",
      label: "Manage RF Sources",
      icon: <Cog size={14} />,
      description: "Open antenna placement and drive settings",
      action: () => p.onSelectModelNode?.("antennas"),
    },
    {
      id: "add-microstrip",
      label: "Add Microstrip",
      icon: <Plus size={14} />,
      description: "Single strip conductor over the magnetic guide",
      action: () => p.onAddAntenna?.("MicrostripAntenna"),
    },
    {
      id: "add-cpw",
      label: "Add CPW",
      icon: <Plus size={14} />,
      description: "Signal strip with symmetric return grounds",
      action: () => p.onAddAntenna?.("CPWAntenna"),
    },
  ];

  if ((p.antennaSources?.length ?? 0) > 0) {
    antennaMenuItems.push({ id: "sep-existing", label: "", separator: true });
    for (const antenna of p.antennaSources ?? []) {
      antennaMenuItems.push({
        id: `ant-${antenna.name}`,
        label: antenna.name,
        icon: <RadioTower size={14} />,
        description: `${antenna.kind} · ${(antenna.currentA * 1e3).toFixed(2)} mA`,
        active: p.selectedAntennaName === antenna.name,
        action: () => p.onSelectModelNode?.(`ant-${antenna.name}`),
      });
    }
  }

  return [
    {
      id: "script", title: "Script",
      actions: [
        { id: "open", icon: <FileText size={20} />, label: "Open", tooltip: "Open script file", shortcut: "Ctrl+O", disabled: true, iconColor: "text-sky-400" },
        { id: p.runAction ?? "run", icon: <Play size={20} fill="currentColor" />, label: p.runLabel ?? "Run", tooltip: p.runLabel === "Resume" ? "Resume the paused solver stage" : "Run simulation", shortcut: "F5", accent: true, disabled: !p.canRun, action: () => p.onSimAction?.(p.runAction ?? "run") },
      ],
    },
    {
      id: "additions", title: "Additions",
      actions: [
        { 
          id: "geometry", icon: <Shapes size={20} />, label: "Objects", tooltip: "Add new geometric objects", iconColor: "text-emerald-400",
          menuItems: [
            { id: "add-box", label: "Add Box", icon: <Box size={14} />, description: "Rectangular cuboid", action: () => alert("Not implemented yet") },
            { id: "add-cylinder", label: "Add Cylinder", icon: <Box size={14} />, description: "Standard cylinder", action: () => alert("Not implemented yet") },
            { separator: true, id: "sep-geo", label: "" },
            { id: "import-stl", label: "Import STL...", icon: <FileText size={14} />, description: "Load external mesh", action: () => alert("Not implemented yet") },
          ]
        },
        { id: "material", icon: <FlaskConical size={20} />, label: "Material", tooltip: "Material properties", disabled: true, iconColor: "text-amber-400" },
        {
          id: "antenna",
          icon: <RadioTower size={20} />,
          label: "Antennas",
          tooltip: "Add and select microwave RF sources",
          active: p.selectedNodeId === "antennas" || Boolean(p.selectedAntennaName),
          iconColor: "text-cyan-400",
          menuItems: antennaMenuItems,
        },
        { id: "mesh", icon: <Hexagon size={20} />, label: "Mesh", tooltip: "Mesh / geometry view", active: p.viewMode === "Mesh", action: () => p.onViewChange?.("Mesh"), iconColor: "text-fuchsia-400" },
      ],
    },
    {
      id: "solver", title: "Solver",
      actions: [
        { id: "relax", icon: <Target size={20} />, label: "Relax", tooltip: "Run relaxation to equilibrium", disabled: !p.canRelax, action: () => p.onSimAction?.("relax"), iconColor: "text-indigo-400" },
        { id: p.runAction ?? "run", icon: <Play size={20} fill="currentColor" />, label: p.runLabel ?? "Run", tooltip: p.runLabel === "Resume" ? "Resume the paused solver stage" : "Run until the configured stop time", accent: true, disabled: !p.canRun, action: () => p.onSimAction?.(p.runAction ?? "run") },
        { id: "pause", icon: <Pause size={20} fill="currentColor" />, label: "Pause", tooltip: "Pause solver", disabled: !p.canPause, action: () => p.onSimAction?.("pause"), iconColor: "text-amber-500" },
        { id: "stop", icon: <Square size={20} fill="currentColor" />, label: "Stop", tooltip: "Stop solver", disabled: !p.canStop, action: () => p.onSimAction?.("stop"), iconColor: "text-rose-500" },
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
        {
          id: "generate",
          icon: <RefreshCw size={20} className={cn(p.meshGenerating && "animate-spin")} />,
          label: p.meshGenerating ? "Working..." : "Generate",
          tooltip: "Re-generate mesh",
          accent: true,
          disabled: !p.isFemBackend || p.meshGenerating,
          action: () => {
            p.onSelectModelNode?.("universe-mesh");
            p.onGenerateMesh?.();
          },
        },
        { id: "import", icon: <FileText size={20} />, label: "Import", tooltip: "Import mesh file", disabled: true, iconColor: "text-sky-400" },
      ],
    },
    {
      id: "mesh-quality", title: "Quality",
      actions: [
        {
          id: "quality",
          icon: <ListChecks size={20} />,
          label: "Quality",
          tooltip: "View mesh quality metrics",
          action: () => {
            p.onSelectModelNode?.("universe-mesh-quality");
            p.onViewChange?.("Mesh");
          },
          iconColor: "text-emerald-400",
        },
        { id: "refine", icon: <Ruler size={20} />, label: "Refine", tooltip: "Adaptive mesh refinement", disabled: true, iconColor: "text-purple-400" },
      ],
    },
    {
      id: "mesh-export", title: "Export",
      actions: [
        { id: "export-vtk", icon: <Download size={20} />, label: "VTK", tooltip: "Export VTK mesh", action: p.onExport, iconColor: "text-blue-400" },
        { id: "save-state", icon: <Save size={20} />, label: "State", tooltip: "Download magnetization state (JSON)", action: p.onStateExport, iconColor: "text-emerald-400" },
        { id: "snapshot", icon: <Camera size={20} />, label: "Capture", tooltip: "Take viewport screenshot", action: p.onCapture, iconColor: "text-violet-400" },
      ],
    },
    buildViewGroup(p),
  ];
}

function buildStudyGroups(p: RibbonBarProps): RibbonGroup[] {
  return [
    {
      id: "execution", title: "Execution",
      actions: [
        { id: "relax", icon: <Target size={20} />, label: "Relax", tooltip: "Run relaxation to equilibrium", disabled: !p.canRelax, action: () => p.onSimAction?.("relax"), iconColor: "text-indigo-400" },
        { id: p.runAction ?? "run", icon: <Play size={20} fill="currentColor" />, label: p.runLabel ?? "Run", tooltip: p.runLabel === "Resume" ? "Resume the paused solver stage" : "Run until the configured stop time", shortcut: "F5", accent: true, disabled: !p.canRun, action: () => p.onSimAction?.(p.runAction ?? "run") },
        { id: "pause", icon: <Pause size={20} fill="currentColor" />, label: "Pause", tooltip: "Pause solver", disabled: !p.canPause, action: () => p.onSimAction?.("pause"), iconColor: "text-amber-500" },
        { id: "stop", icon: <Square size={20} fill="currentColor" />, label: "Stop", tooltip: "Stop solver", disabled: !p.canStop, action: () => p.onSimAction?.("stop"), iconColor: "text-rose-500" },
      ],
    },
    buildViewGroup(p),
  ];
}

function buildResultsGroups(p: RibbonBarProps): RibbonGroup[] {
  const quickPreviewActions: RibbonAction[] =
    (p.quickPreviewTargets?.slice(0, 6) ?? []).map((target) => {
      const lowerId = target.id.toLowerCase();
      const lowerLabel = target.shortLabel.toLowerCase();
      const icon =
        target.id === "m" ? <Magnet size={20} /> :
        (lowerId.includes("demag") || lowerLabel.includes("demag")) ? <Shapes size={20} /> :
        (lowerId.includes("ex") || lowerLabel.includes("exchange")) ? <Zap size={20} /> :
        (lowerId.startsWith("e_") || lowerLabel.startsWith("e")) ? <BarChart3 size={20} /> :
        <Eye size={20} />;
      const iconColor =
        target.id === "m" ? "text-rose-400" :
        (lowerId.includes("demag") || lowerLabel.includes("demag")) ? "text-fuchsia-400" :
        (lowerId.includes("ex") || lowerLabel.includes("exchange")) ? "text-yellow-400" :
        (lowerId.startsWith("e_") || lowerLabel.startsWith("e")) ? "text-emerald-400" :
        "text-sky-400";
      return {
        id: `quantity-${target.id}`,
        icon,
        label: target.shortLabel,
        tooltip: `Switch preview to ${target.shortLabel}`,
        active: p.selectedQuantity === target.id,
        disabled: !target.available,
        iconColor,
        action: () => p.onQuickPreviewSelect?.(target.id),
      };
    });

  return [
    {
      id: "quantity", title: "Quantity",
      actions: quickPreviewActions.length > 0
        ? quickPreviewActions
        : [
            { id: "magnetization", icon: <Magnet size={20} />, label: "M", tooltip: "Magnetization preview", active: true, iconColor: "text-rose-400" },
            { id: "exchange", icon: <Zap size={20} />, label: "H_ex", tooltip: "Exchange field preview", iconColor: "text-yellow-400" },
            { id: "demag", icon: <Shapes size={20} />, label: "H_dem", tooltip: "Demagnetization field preview", iconColor: "text-fuchsia-400" },
          ],
    },
    {
      id: "plot-tools", title: "Plot",
      actions: [
        { id: "plot", icon: <BarChart3 size={20} />, label: "Chart", tooltip: "Open scalar plot", action: () => p.onViewChange?.("charts"), iconColor: "text-emerald-400" },
        { id: "snapshot", icon: <Camera size={20} />, label: "Capture", tooltip: "Take viewport screenshot", action: p.onCapture, iconColor: "text-violet-400" },
        { id: "exportvtk", icon: <Download size={20} />, label: "VTK", tooltip: "Export VTK", action: p.onExport, iconColor: "text-blue-400" },
        { id: "save-state", icon: <Save size={20} />, label: "State", tooltip: "Download magnetization state (JSON)", action: p.onStateExport, iconColor: "text-emerald-400" },
      ],
    },
    {
      id: "analyze", title: "Analyze",
      actions: [
        { id: "analyze-spectrum", icon: <BarChart3 size={20} />, label: "Spectrum", tooltip: "Eigenmode spectrum & mode inspector", active: p.viewMode === "Analyze", action: () => p.onViewChange?.("Analyze"), iconColor: "text-violet-400" },
      ],
    },
    buildViewGroup(p),
  ];
}

function buildViewGroup(p: RibbonBarProps): RibbonGroup {
  return {
    id: "view", title: "View",
    actions: [
      { id: "3d", icon: <Box size={20} />, label: "3D", tooltip: "3D view", shortcut: "1", active: p.viewMode === "3D", action: () => p.onViewChange?.("3D"), iconColor: "text-indigo-400" },
      { id: "2d", icon: <Columns2 size={20} />, label: "2D", tooltip: "2D view", shortcut: "2", active: p.viewMode === "2D", action: () => p.onViewChange?.("2D"), iconColor: "text-sky-400" },
      { id: "mesh-view", icon: <Grid3X3 size={20} />, label: "Mesh", tooltip: "Mesh view", shortcut: "3", active: p.viewMode === "Mesh", action: () => p.onViewChange?.("Mesh"), iconColor: "text-fuchsia-400" },
      { id: "sidebar", icon: <PanelRight size={20} />, label: "Panel", tooltip: "Toggle sidebar", shortcut: "Ctrl+B", active: p.sidebarVisible, action: p.onSidebarToggle, iconColor: "text-slate-400" },
      { id: "eye", icon: <Eye size={20} />, label: "Focus", tooltip: p.selectedObjectId ? "Focus camera on selected object" : "Select an object to focus", disabled: !p.selectedObjectId, iconColor: "text-teal-400", action: () => { if (p.selectedObjectId) p.onRequestObjectFocus?.(p.selectedObjectId); } },
    ],
  };
}

const RibbonActionTrigger = React.forwardRef<
  HTMLButtonElement,
  {
    action: RibbonAction;
    previewPending?: boolean;
  } & React.ButtonHTMLAttributes<HTMLButtonElement>
>(({ action, previewPending, ...props }, ref) => {
  return (
    <button
      ref={ref}
      className={cn(
        "flex min-h-[56px] min-w-[60px] flex-col items-center justify-center gap-1.5 rounded-md border p-1 transition-all",
        action.active
          ? "border-primary/20 bg-primary/10 text-primary shadow-inner"
          : action.accent
            ? "border-transparent bg-primary text-primary-foreground shadow-sm hover:bg-primary/90"
            : "border-transparent text-foreground hover:border-border/50 hover:bg-muted/80",
        previewPending && action.active && "animate-pulse shadow-[0_0_0_1px_rgba(99,102,241,0.35)]",
        action.disabled && "pointer-events-none cursor-not-allowed opacity-40",
      )}
      disabled={action.disabled}
      onClick={(e) => {
        if (action.action) action.action();
        if (props.onClick) props.onClick(e);
      }}
      {...props}
    >
      <span
        className={cn(
          "flex flex-col items-center",
          action.accent
            ? "text-primary-foreground"
            : action.active
              ? "text-primary"
              : action.iconColor ?? "text-muted-foreground",
        )}
      >
        {action.icon}
      </span>
      <span
        className={cn(
          "text-[0.65rem] font-medium leading-none",
          action.accent
            ? "text-primary-foreground"
            : action.active
              ? "text-primary"
              : "text-foreground",
        )}
      >
        {action.label}
      </span>
    </button>
  );
});
RibbonActionTrigger.displayName = "RibbonActionTrigger";

const TABS: RibbonTab[] = ["Home", "Mesh", "Study", "Results"];

/* ── Component ──────────────────────────────────── */

export default function RibbonBar(props: RibbonBarProps) {
  const inferredTab = inferTab(props.selectedNodeId);
  const [manualTab, setManualTab] = useState<RibbonTab | null>(null);

  useEffect(() => {
    setManualTab(null);
  }, [props.selectedNodeId]);

  const activeTab = manualTab ?? inferredTab;

  const groups = useMemo(() => {
    switch (activeTab) {
      case "Mesh": return buildMeshGroups(props);
      case "Study": return buildStudyGroups(props);
      case "Results": return buildResultsGroups(props);
      default: return buildHomeGroups(props);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeTab,
    props.viewMode,
    props.isFemBackend,
    props.solverRunning,
    props.sidebarVisible,
    props.selectedNodeId,
    props.canRun,
    props.canRelax,
    props.canPause,
    props.canStop,
    props.quickPreviewTargets,
    props.selectedQuantity,
    props.antennaSources,
    props.selectedAntennaName,
  ]);

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex flex-col w-full bg-card/20 border-b border-border/20 backdrop-blur-xl shadow-sm shrink-0 z-30">
        {/* ── Tab row ── */}
        <div className="flex px-3 pt-2 gap-1 border-b border-border/20">
          {TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => {
                setManualTab(tab);
                if (props.onSelectModelNode) {
                  if (tab === "Home") props.onSelectModelNode("universe");
                  else if (tab === "Mesh") props.onSelectModelNode("universe-mesh");
                  else if (tab === "Study") props.onSelectModelNode("study");
                  else if (tab === "Results") props.onSelectModelNode("results");
                }
              }}
              className={cn(
                "px-5 py-2 min-w-[80px] text-[0.82rem] font-medium transition-colors rounded-t-lg border-b-2 font-sans cursor-pointer hover:bg-muted/30",
                tab === activeTab 
                  ? "border-primary bg-primary/10 text-primary" 
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
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
                  {group.actions.map((action) =>
                    action.menuItems && action.menuItems.length > 0 ? (
                      <DropdownMenu.Root key={action.id}>
                        <DropdownMenu.Trigger asChild>
                          <RibbonActionTrigger action={action} previewPending={props.previewPending} />
                        </DropdownMenu.Trigger>
                        <DropdownMenu.Portal>
                          <DropdownMenu.Content
                            className="z-[100] min-w-[280px] rounded-md border border-border/50 bg-popover/95 p-1 text-popover-foreground shadow-md backdrop-blur-xl animate-in fade-in-80 slide-in-from-top-1"
                            sideOffset={8}
                            align="start"
                          >
                            {action.menuItems.map((item) =>
                              item.separator ? (
                                <DropdownMenu.Separator
                                  key={item.id}
                                  className="my-1 h-px bg-border/50"
                                />
                              ) : (
                                <DropdownMenu.Item
                                  key={item.id}
                                  className={cn(
                                    "relative flex cursor-default select-none items-start gap-2 rounded-sm px-2 py-2 text-xs outline-none transition-colors data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-muted data-[highlighted]:text-foreground",
                                    item.active && "bg-primary/10 text-primary",
                                  )}
                                  disabled={item.disabled}
                                  onSelect={() => item.action?.()}
                                >
                                  <span className="mt-0.5 flex h-4 w-4 items-center justify-center text-muted-foreground opacity-80">
                                    {item.icon}
                                  </span>
                                  <span className="min-w-0 flex-1">
                                    <span className="block truncate font-medium">{item.label}</span>
                                    {item.description ? (
                                      <span className="block truncate text-[0.68rem] text-muted-foreground">
                                        {item.description}
                                      </span>
                                    ) : null}
                                  </span>
                                </DropdownMenu.Item>
                              ),
                            )}
                          </DropdownMenu.Content>
                        </DropdownMenu.Portal>
                      </DropdownMenu.Root>
                    ) : (
                      <Tooltip key={action.id}>
                        <TooltipTrigger asChild>
                          <RibbonActionTrigger action={action} previewPending={props.previewPending} />
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
                    ),
                  )}
                </div>
                <span className="text-[0.6rem] font-medium text-muted-foreground mt-1 pt-1 opacity-70 border-t border-border/20 w-full text-center">
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
