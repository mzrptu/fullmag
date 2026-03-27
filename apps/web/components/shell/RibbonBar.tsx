"use client";

import {
  FileText, Play, Pause, Square, Box, Columns2, Grid3X3,
  PanelRight, Camera, Download, BarChart3,
  Shapes, FlaskConical, Hexagon, Cog, Eye,
} from "lucide-react";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip, TooltipTrigger, TooltipContent, TooltipProvider,
} from "@/components/ui/tooltip";
import s from "./shell.module.css";

/* ── Types ──────────────────────────────────────── */

interface RibbonAction {
  id: string;
  icon: React.ReactNode;
  label: string;
  tooltip?: string;
  disabled?: boolean;
  active?: boolean;
  action?: () => void;
}

interface RibbonGroup {
  id: string;
  title: string;
  actions: RibbonAction[];
}

interface RibbonBarProps {
  viewMode?: string;
  isFemBackend?: boolean;
  solverRunning?: boolean;
  sidebarVisible?: boolean;
  onViewChange?: (mode: string) => void;
  onSidebarToggle?: () => void;
  onSimAction?: (action: string) => void;
  onExport?: () => void;
}

function buildGroups(props: RibbonBarProps): RibbonGroup[] {
  return [
    {
      id: "script",
      title: "Script",
      actions: [
        { id: "open", icon: <FileText size={18} />, label: "Open", tooltip: "Open script file" },
        { id: "run", icon: <Play size={18} />, label: "Run", tooltip: "Run simulation (F5)", action: () => props.onSimAction?.("run") },
      ],
    },
    {
      id: "model",
      title: "Model",
      actions: [
        { id: "geometry", icon: <Shapes size={18} />, label: "Geometry", tooltip: "Define geometry" },
        { id: "material", icon: <FlaskConical size={18} />, label: "Material", tooltip: "Material properties" },
        { id: "mesh", icon: <Hexagon size={18} />, label: "Mesh", tooltip: "Mesh controls", active: props.viewMode === "Mesh" },
      ],
    },
    {
      id: "solver",
      title: "Solver",
      actions: [
        { id: "configure", icon: <Cog size={18} />, label: "Setup", tooltip: "Solver configuration" },
        { id: "solve", icon: <Play size={18} />, label: "Solve", tooltip: "Start solver", action: () => props.onSimAction?.("run") },
        { id: "pause", icon: <Pause size={18} />, label: "Pause", tooltip: "Pause solver", disabled: !props.solverRunning, action: () => props.onSimAction?.("pause") },
        { id: "stop", icon: <Square size={18} />, label: "Stop", tooltip: "Stop solver", disabled: !props.solverRunning, action: () => props.onSimAction?.("stop") },
      ],
    },
    {
      id: "results",
      title: "Results",
      actions: [
        { id: "plot", icon: <BarChart3 size={18} />, label: "Plot", tooltip: "Open scalar plot" },
        { id: "snapshot", icon: <Camera size={18} />, label: "Capture", tooltip: "Take snapshot" },
        { id: "exportvtk", icon: <Download size={18} />, label: "Export", tooltip: "Export VTK", action: props.onExport },
      ],
    },
    {
      id: "view",
      title: "View",
      actions: [
        { id: "3d", icon: <Box size={18} />, label: "3D", tooltip: "3D view (1)", active: props.viewMode === "3D", action: () => props.onViewChange?.("3D") },
        { id: "2d", icon: <Columns2 size={18} />, label: "2D", tooltip: "2D view (2)", active: props.viewMode === "2D", action: () => props.onViewChange?.("2D") },
        { id: "mesh", icon: <Grid3X3 size={18} />, label: "Mesh", tooltip: "Mesh view (3)", active: props.viewMode === "Mesh", disabled: !props.isFemBackend, action: () => props.onViewChange?.("Mesh") },
        { id: "sidebar", icon: <PanelRight size={18} />, label: "Panel", tooltip: "Toggle sidebar (Ctrl+B)", active: props.sidebarVisible, action: props.onSidebarToggle },
        { id: "eye", icon: <Eye size={18} />, label: "Focus", tooltip: "Focus mode" },
      ],
    },
  ];
}

/* ── Component ──────────────────────────────────── */

export default function RibbonBar(props: RibbonBarProps) {
  const groups = buildGroups(props);

  return (
    <TooltipProvider delayDuration={300}>
      <div className={s.ribbonBar}>
        {groups.map((group, gi) => (
          <div key={group.id} className={s.ribbonGroup}>
            {gi > 0 && <Separator orientation="vertical" className={s.ribbonSep} />}
            <div className={s.ribbonGroupInner}>
              <div className={s.ribbonActions}>
                {group.actions.map((action) => (
                  <Tooltip key={action.id}>
                    <TooltipTrigger asChild>
                      <button
                        className={s.ribbonBtn}
                        data-active={action.active ?? false}
                        disabled={action.disabled}
                        onClick={action.action}
                      >
                        <span className={s.ribbonIcon}>{action.icon}</span>
                        <span className={s.ribbonLabel}>{action.label}</span>
                      </button>
                    </TooltipTrigger>
                    {action.tooltip && (
                      <TooltipContent side="bottom">
                        {action.tooltip}
                      </TooltipContent>
                    )}
                  </Tooltip>
                ))}
              </div>
              <span className={s.ribbonGroupTitle}>{group.title}</span>
            </div>
          </div>
        ))}
      </div>
    </TooltipProvider>
  );
}
