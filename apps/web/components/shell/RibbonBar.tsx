"use client";

import React, { useMemo, useEffect, useCallback } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  FileText, Play, Pause, Square, Box, Columns2, Grid3X3,
  PanelRight, Camera, Download, BarChart3,
  Shapes, FlaskConical, Hexagon, Cog, Eye,
  RefreshCw, Ruler, ListChecks, Zap, Magnet, Target, Save, Plus, RadioTower,
  Sparkles, FunctionSquare, Layers3, Binary,
} from "lucide-react";
import {
  Tooltip, TooltipTrigger, TooltipContent, TooltipProvider,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { WorkspaceMode } from "../runs/control-room/context-hooks";
import { useWorkspaceStore } from "@/lib/workspace/workspace-store";
import {
  parseStudyNodeContext,
  type StudyNodeContext,
} from "@/lib/study-builder/node-context";
import type { StudyPrimitiveStageKind } from "@/lib/study-builder/types";
import type { ScriptBuilderMagneticInteractionKind } from "@/lib/session/types";
import {
  canExecuteRibbonCommand,
  executeRibbonCommand,
  type RibbonCommand,
} from "./ribbon/command-registry";

/* ── Types ──────────────────────────────────────── */

interface RibbonAction {
  id: string;
  icon: React.ReactNode;
  label: string;
  tooltip?: string;
  shortcut?: string;
  disabled?: boolean;
  hidden?: boolean;
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
  hidden?: boolean;
  active?: boolean;
  separator?: boolean;
  action?: () => void;
}

interface RibbonGroup {
  id: string;
  title: string;
  actions: RibbonAction[];
}

type RibbonTab =
  | "Home"
  | "Definitions"
  | "Geometry"
  | "Materials"
  | "Physics"
  | "Mesh"
  | "Study"
  | "Results"
  | "Automation";

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
  onCreateVisualizationPreset?: () => void;
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
  meshConfigDirty?: boolean;
  meshTargetLabel?: string | null;
  onBuildMeshSelected?: () => void;
  onBuildMeshAll?: () => void;
  onOpenMeshInspector?: () => void;
  onOpenMeshQuality?: () => void;
  onOpenMeshSizeSettings?: () => void;
  onOpenMeshMethodSettings?: () => void;
  onOpenMeshPipeline?: () => void;
  selectedObjectId?: string | null;
  onRequestObjectFocus?: (objectId: string) => void;
  hasSharedAirboxDomain?: boolean;
  canSyncScriptBuilder?: boolean;
  scriptSyncBusy?: boolean;
  onSyncScriptBuilder?: () => void;
  workspaceMode?: WorkspaceMode;
  onStudyAddPrimitive?: (
    kind: StudyPrimitiveStageKind,
    placement: "append" | "before" | "after",
  ) => void;
  onStudyAddMacro?: (
    kind:
      | "hysteresis_loop"
      | "field_sweep_relax"
      | "field_sweep_relax_snapshot"
      | "relax_run"
      | "relax_eigenmodes"
      | "parameter_sweep",
    placement: "append" | "before" | "after",
  ) => void;
  onStudyDuplicateSelected?: () => void;
  onStudyToggleSelectedEnabled?: () => void;
  onObjectAddInteraction?: (
    objectId: string,
    kind: ScriptBuilderMagneticInteractionKind,
  ) => void;
}

/* ── Tab inference from tree node ── */
function tabsForMode(mode: WorkspaceMode | undefined): RibbonTab[] {
  void mode;
  return [
    "Home",
    "Definitions",
    "Geometry",
    "Materials",
    "Physics",
    "Mesh",
    "Study",
    "Results",
    "Automation",
  ];
}

interface ContextualRibbonTab {
  id: "selected-ferromagnet" | "interface" | "work-plane" | "mesh-quality" | "plot" | "table";
  label: string;
}

function runCommand(p: RibbonBarProps, command: RibbonCommand): void {
  executeRibbonCommand(p, command);
}

function canCommand(p: RibbonBarProps, command: RibbonCommand): boolean {
  return canExecuteRibbonCommand(p, command);
}

function contextualTabsForSelection(p: RibbonBarProps): ContextualRibbonTab[] {
  const nodeId = p.selectedNodeId ?? "";
  const tabs: ContextualRibbonTab[] = [];
  if (p.selectedObjectId) {
    tabs.push({ id: "selected-ferromagnet", label: "Selected Ferromagnet" });
  }
  if (nodeId.includes("interface") || nodeId.includes("boundary")) {
    tabs.push({ id: "interface", label: "Interface" });
  }
  if (nodeId.includes("work-plane") || nodeId.includes("plane")) {
    tabs.push({ id: "work-plane", label: "Work Plane" });
  }
  if (
    nodeId.includes("mesh-quality")
    || nodeId === "mesh-pipeline"
    || nodeId === "universe-mesh-quality"
    || nodeId === "universe-mesh-pipeline"
  ) {
    tabs.push({ id: "mesh-quality", label: "Mesh Quality" });
  }
  if (nodeId.startsWith("res-") || nodeId === "results" || p.viewMode === "Analyze") {
    tabs.push({ id: "plot", label: "Plot" });
    tabs.push({ id: "table", label: "Table" });
  }
  return tabs;
}

/* ── Group builders per tab ── */
function buildHomeGroups(p: RibbonBarProps): RibbonGroup[] {
  const antennaMenuItems: RibbonMenuItem[] = [
    {
      id: "manage-antennas",
      label: "Manage RF Sources",
      icon: <Cog size={14} />,
      description: "Open antenna placement and drive settings",
      action: () => runCommand(p, { id: "navigation.select-node", nodeId: "antennas" }),
    },
    {
      id: "add-microstrip",
      label: "Add Microstrip",
      icon: <Plus size={14} />,
      description: "Single strip conductor over the magnetic guide",
      disabled: !canCommand(p, { id: "antenna.add", kind: "MicrostripAntenna" }),
      action: () => runCommand(p, { id: "antenna.add", kind: "MicrostripAntenna" }),
    },
    {
      id: "add-cpw",
      label: "Add CPW",
      icon: <Plus size={14} />,
      description: "Signal strip with symmetric return grounds",
      disabled: !canCommand(p, { id: "antenna.add", kind: "CPWAntenna" }),
      action: () => runCommand(p, { id: "antenna.add", kind: "CPWAntenna" }),
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
        action: () => runCommand(p, { id: "navigation.select-node", nodeId: `ant-${antenna.name}` }),
      });
    }
  }

  return [
    {
      id: "script", title: "Script",
      actions: [
        { id: "open", icon: <FileText size={20} />, label: "Open", tooltip: "Open script file", shortcut: "Ctrl+O", disabled: true, iconColor: "text-sky-400" },
        {
          id: p.runAction ?? "run",
          icon: <Play size={20} fill="currentColor" />,
          label: p.runLabel ?? "Run",
          tooltip: p.runLabel === "Resume" ? "Resume the paused solver stage" : "Run simulation",
          shortcut: "F5",
          accent: true,
          disabled: !canCommand(p, { id: "solver.control", action: "run" }),
          action: () => runCommand(p, { id: "solver.control", action: "run" }),
        },
      ],
    },
    {
      id: "additions", title: "Additions",
      actions: [
        { 
          id: "geometry", icon: <Shapes size={20} />, label: "Objects", tooltip: "Add new geometric objects", iconColor: "text-emerald-400",
          menuItems: [
            { id: "add-box", label: "Add Box", icon: <Box size={14} />, description: "Rectangular cuboid (coming next)", disabled: true, hidden: true },
            { id: "add-cylinder", label: "Add Cylinder", icon: <Box size={14} />, description: "Standard cylinder (coming next)", disabled: true, hidden: true },
            { separator: true, id: "sep-geo", label: "" },
            { id: "import-stl", label: "Import STL...", icon: <FileText size={14} />, description: "Load external mesh (coming next)", disabled: true, hidden: true },
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
        {
          id: "mesh",
          icon: <Hexagon size={20} />,
          label: "Mesh",
          tooltip: "Mesh / geometry view",
          active: p.viewMode === "Mesh",
          action: () => runCommand(p, { id: "viewport.set-mode", mode: "Mesh" }),
          iconColor: "text-fuchsia-400",
        },
      ],
    },
    {
      id: "solver", title: "Solver",
      actions: [
        {
          id: "relax",
          icon: <Target size={20} />,
          label: "Relax",
          tooltip: "Run relaxation to equilibrium",
          disabled: !canCommand(p, { id: "solver.control", action: "relax" }),
          action: () => runCommand(p, { id: "solver.control", action: "relax" }),
          iconColor: "text-indigo-400",
        },
        {
          id: p.runAction ?? "run",
          icon: <Play size={20} fill="currentColor" />,
          label: p.runLabel ?? "Run",
          tooltip: p.runLabel === "Resume" ? "Resume the paused solver stage" : "Run until the configured stop time",
          accent: true,
          disabled: !canCommand(p, { id: "solver.control", action: "run" }),
          action: () => runCommand(p, { id: "solver.control", action: "run" }),
        },
        {
          id: "pause",
          icon: <Pause size={20} fill="currentColor" />,
          label: "Pause",
          tooltip: "Pause solver",
          disabled: !canCommand(p, { id: "solver.control", action: "pause" }),
          action: () => runCommand(p, { id: "solver.control", action: "pause" }),
          iconColor: "text-amber-500",
        },
        {
          id: "stop",
          icon: <Square size={20} fill="currentColor" />,
          label: "Stop",
          tooltip: "Stop solver",
          disabled: !canCommand(p, { id: "solver.control", action: "stop" }),
          action: () => runCommand(p, { id: "solver.control", action: "stop" }),
          iconColor: "text-rose-500",
        },
      ],
    },
    buildViewGroup(p),
  ];
}

function buildDefinitionsGroups(p: RibbonBarProps): RibbonGroup[] {
  return [
    {
      id: "definitions-model",
      title: "Definitions",
      actions: [
        {
          id: "definitions-parameters",
          icon: <Binary size={20} />,
          label: "Parameters",
          tooltip: "Open model parameters and global variables (coming next)",
          disabled: true,
          hidden: true,
          iconColor: "text-slate-400",
        },
        {
          id: "definitions-functions",
          icon: <FunctionSquare size={20} />,
          label: "Functions",
          tooltip: "Open global functions and dependencies (coming next)",
          disabled: true,
          hidden: true,
          iconColor: "text-slate-400",
        },
        {
          id: "definitions-coordinates",
          icon: <Ruler size={20} />,
          label: "Coordinates",
          tooltip: "Coordinate systems and frames (coming next)",
          disabled: true,
          hidden: true,
          iconColor: "text-slate-400",
        },
      ],
    },
    buildViewGroup(p),
  ];
}

function buildGeometryGroups(p: RibbonBarProps): RibbonGroup[] {
  return [
    {
      id: "geometry-model",
      title: "Objects",
      actions: [
        {
          id: "geometry-open-objects",
          icon: <Shapes size={20} />,
          label: "Objects",
          tooltip: "Open object list in Model Builder",
          action: () => runCommand(p, { id: "navigation.select-node", nodeId: "objects" }),
          iconColor: "text-emerald-400",
        },
        {
          id: "geometry-open-universe",
          icon: <Box size={20} />,
          label: "Universe",
          tooltip: "Open universe and airbox settings",
          action: () => runCommand(p, { id: "navigation.select-node", nodeId: "universe" }),
          iconColor: "text-cyan-400",
        },
      ],
    },
    {
      id: "geometry-import",
      title: "Import",
      actions: [
        {
          id: "geometry-import-stl",
          icon: <FileText size={20} />,
          label: "Import STL",
          tooltip: "Import geometry asset (coming next)",
          disabled: true,
          hidden: true,
          iconColor: "text-slate-400",
        },
      ],
    },
    buildViewGroup(p),
  ];
}

function buildMeshGroups(p: RibbonBarProps): RibbonGroup[] {
  return [
    {
      id: "mesh-build", title: "Build",
      actions: [
        {
          id: "build-selected",
          icon: <RefreshCw size={20} className={cn(p.meshGenerating && "animate-spin")} />,
          label: p.meshGenerating ? "Building..." : "Build Selected",
          tooltip: p.meshTargetLabel ? `Build ${p.meshTargetLabel}` : "Build the selected mesh target",
          accent: true,
          disabled: !canCommand(p, { id: "mesh.build-selected" }),
          action: () => runCommand(p, { id: "mesh.build-selected" }),
        },
        {
          id: "build-all",
          icon: <Zap size={20} />,
          label: "Build All",
          tooltip: "Rebuild the full shared-domain study mesh",
          disabled: !canCommand(p, { id: "mesh.build-all" }),
          action: () => runCommand(p, { id: "mesh.build-all" }),
          iconColor: "text-cyan-400",
        },
        {
          id: "statistics",
          icon: <BarChart3 size={20} />,
          label: "Statistics",
          tooltip: "Open mesh quality and statistics",
          disabled: !canCommand(p, { id: "mesh.open-quality" }),
          action: () => runCommand(p, { id: "mesh.open-quality" }),
          iconColor: "text-emerald-400",
        },
      ],
    },
    {
      id: "mesh-size", title: "Size",
      actions: [
        {
          id: "size-controls",
          icon: <Ruler size={20} />,
          label: "Element Size",
          tooltip: "Open maximum, minimum and growth controls",
          disabled: !canCommand(p, { id: "mesh.open-size-settings" }),
          action: () => runCommand(p, { id: "mesh.open-size-settings" }),
          iconColor: "text-amber-400",
        },
        {
          id: "narrow-region",
          icon: <Columns2 size={20} />,
          label: "Transitions",
          tooltip: "Open growth-rate and narrow-region controls",
          disabled: !canCommand(p, { id: "mesh.open-size-settings" }),
          action: () => runCommand(p, { id: "mesh.open-size-settings" }),
          iconColor: "text-fuchsia-400",
        },
      ],
    },
    {
      id: "mesh-method", title: "Method",
      actions: [
        {
          id: "method-volume",
          icon: <Hexagon size={20} />,
          label: "Mesher",
          tooltip: "Open tetrahedral mesher algorithm controls",
          disabled: !canCommand(p, { id: "mesh.open-method-settings" }),
          action: () => runCommand(p, { id: "mesh.open-method-settings" }),
          iconColor: "text-indigo-400",
        },
        {
          id: "method-optimize",
          icon: <ListChecks size={20} />,
          label: "Quality",
          tooltip: "Open mesh quality optimization controls",
          disabled: !canCommand(p, { id: "mesh.open-quality" }),
          action: () => runCommand(p, { id: "mesh.open-quality" }),
          iconColor: "text-emerald-400",
        },
      ],
    },
    {
      id: "mesh-view", title: "View",
      actions: [
        {
          id: "mesh-inspector",
          icon: <Eye size={20} />,
          label: "Inspector",
          tooltip: "Open the mesh inspector viewport",
          disabled: !canCommand(p, { id: "mesh.open-inspector" }),
          action: () => runCommand(p, { id: "mesh.open-inspector" }),
          iconColor: "text-cyan-400",
        },
        {
          id: "mesh-focus",
          icon: <Grid3X3 size={20} />,
          label: "Workspace",
          tooltip: "Open the mesh workspace",
          disabled: !canCommand(p, { id: "viewport.set-mode", mode: "Mesh" }),
          action: () => runCommand(p, { id: "viewport.set-mode", mode: "Mesh" }),
          iconColor: "text-fuchsia-400",
        },
        {
          id: "mesh-pipeline",
          icon: <ListChecks size={20} />,
          label: "Pipeline",
          tooltip: "Open mesh pipeline diagnostics",
          disabled: !canCommand(p, { id: "mesh.open-pipeline" }),
          action: () => runCommand(p, { id: "mesh.open-pipeline" }),
          iconColor: "text-orange-400",
        },
      ],
    },
  ];
}

function buildMaterialsGroups(p: RibbonBarProps): RibbonGroup[] {
  const objectId = p.selectedObjectId;
  const hasObject = Boolean(objectId);
  return [
    {
      id: "material-object",
      title: "Object",
      actions: [
        {
          id: "open-magnetic-params",
          icon: <Magnet size={20} />,
          label: "Magnetic Params",
          tooltip: hasObject ? "Open magnetic interaction stack for selected object" : "Select object in tree first",
          disabled: !hasObject,
          action: () => {
            if (!objectId) return;
            runCommand(p, { id: "navigation.select-node", nodeId: `physobj-${objectId}` });
          },
          iconColor: "text-violet-400",
        },
        {
          id: "open-material-panel",
          icon: <FlaskConical size={20} />,
          label: "Material",
          tooltip: hasObject ? "Open material constants for selected object" : "Select object in tree first",
          disabled: !hasObject,
          action: () => {
            if (!objectId) return;
            runCommand(p, { id: "navigation.select-node", nodeId: `mat-${objectId}` });
          },
          iconColor: "text-amber-400",
        },
      ],
    },
    {
      id: "material-add",
      title: "Add Interaction",
      actions: [
        {
          id: "add-dmi",
          icon: <Sparkles size={20} />,
          label: "Add DMI",
          tooltip: hasObject ? "Add interfacial DMI interaction" : "Select object in tree first",
          disabled: !hasObject || !canCommand(p, {
            id: "object.add-interaction",
            objectId: objectId ?? "",
            kind: "interfacial_dmi",
          }),
          action: () => {
            if (!objectId) return;
            runCommand(p, { id: "object.add-interaction", objectId, kind: "interfacial_dmi" });
            runCommand(p, { id: "navigation.select-node", nodeId: `physobj-${objectId}` });
          },
          iconColor: "text-cyan-400",
        },
        {
          id: "add-ku",
          icon: <Binary size={20} />,
          label: "Add Ku",
          tooltip: hasObject ? "Add uniaxial anisotropy interaction" : "Select object in tree first",
          disabled: !hasObject || !canCommand(p, {
            id: "object.add-interaction",
            objectId: objectId ?? "",
            kind: "uniaxial_anisotropy",
          }),
          action: () => {
            if (!objectId) return;
            runCommand(p, { id: "object.add-interaction", objectId, kind: "uniaxial_anisotropy" });
            runCommand(p, { id: "navigation.select-node", nodeId: `physobj-${objectId}` });
          },
          iconColor: "text-rose-400",
        },
      ],
    },
    buildViewGroup(p),
  ];
}

function buildPhysicsGroups(p: RibbonBarProps): RibbonGroup[] {
  const objectId = p.selectedObjectId;
  const hasObject = Boolean(objectId);
  return [
    {
      id: "physics-core",
      title: "Core Terms",
      actions: [
        {
          id: "open-obj-physics",
          icon: <Magnet size={20} />,
          label: "Object Physics",
          tooltip: hasObject ? "Open per-object magnetic interaction stack" : "Select object in tree first",
          disabled: !hasObject,
          action: () => {
            if (!objectId) return;
            runCommand(p, { id: "navigation.select-node", nodeId: `physobj-${objectId}` });
          },
          iconColor: "text-violet-400",
        },
        {
          id: "open-global-physics",
          icon: <Cog size={20} />,
          label: "Global Physics",
          tooltip: "Open global physics status panel",
          action: () => runCommand(p, { id: "navigation.select-node", nodeId: "physics" }),
          iconColor: "text-slate-400",
        },
      ],
    },
    {
      id: "physics-add",
      title: "Optional Terms",
      actions: [
        {
          id: "physics-add-dmi",
          icon: <Sparkles size={20} />,
          label: "DMI",
          tooltip: hasObject ? "Add interfacial DMI to selected object" : "Select object in tree first",
          disabled: !hasObject || !canCommand(p, {
            id: "object.add-interaction",
            objectId: objectId ?? "",
            kind: "interfacial_dmi",
          }),
          action: () => {
            if (!objectId) return;
            runCommand(p, { id: "object.add-interaction", objectId, kind: "interfacial_dmi" });
            runCommand(p, { id: "navigation.select-node", nodeId: `physobj-${objectId}` });
          },
          iconColor: "text-cyan-400",
        },
        {
          id: "physics-add-uni",
          icon: <Binary size={20} />,
          label: "Uniaxial Ku",
          tooltip: hasObject ? "Add uniaxial anisotropy to selected object" : "Select object in tree first",
          disabled: !hasObject || !canCommand(p, {
            id: "object.add-interaction",
            objectId: objectId ?? "",
            kind: "uniaxial_anisotropy",
          }),
          action: () => {
            if (!objectId) return;
            runCommand(p, { id: "object.add-interaction", objectId, kind: "uniaxial_anisotropy" });
            runCommand(p, { id: "navigation.select-node", nodeId: `physobj-${objectId}` });
          },
          iconColor: "text-rose-400",
        },
      ],
    },
    buildViewGroup(p),
  ];
}

function buildStudyBuilderGroups(
  p: RibbonBarProps,
  studyNode: StudyNodeContext | null,
): RibbonGroup[] {
  const hasStageSelection = studyNode?.kind === "study-stage";
  const placement = hasStageSelection ? "after" : "append";
  return [
    {
      id: "study-nav",
      title: "Study",
      actions: [
        {
          id: "study-overview",
          icon: <Cog size={20} />,
          label: "Overview",
          tooltip: "Study root and authoring summary",
          active: studyNode?.kind === "study-root" || studyNode?.kind === "simulation-root",
          iconColor: "text-slate-400",
          action: () => runCommand(p, { id: "navigation.select-node", nodeId: "study" }),
        },
        {
          id: "study-defaults",
          icon: <Columns2 size={20} />,
          label: "Defaults",
          tooltip: "Runtime, solver and output defaults",
          active:
            studyNode?.kind === "study-defaults"
            || studyNode?.kind === "study-runtime-defaults"
            || studyNode?.kind === "study-solver-defaults"
            || studyNode?.kind === "study-physics-defaults"
            || studyNode?.kind === "study-outputs-defaults",
          iconColor: "text-cyan-400",
          action: () => runCommand(p, { id: "navigation.select-node", nodeId: "study-defaults" }),
          menuItems: [
            {
              id: "study-defaults-runtime",
              label: "Runtime Defaults",
              icon: <Play size={14} />,
              description: "Run horizon, execution mode and runtime policy",
              active: studyNode?.kind === "study-runtime-defaults",
              action: () => runCommand(p, { id: "navigation.select-node", nodeId: "study-defaults-runtime" }),
            },
            {
              id: "study-defaults-solver",
              label: "Solver Defaults",
              icon: <Target size={14} />,
              description: "Integrator, relaxation and convergence defaults",
              active: studyNode?.kind === "study-solver-defaults",
              action: () => runCommand(p, { id: "navigation.select-node", nodeId: "study-defaults-solver" }),
            },
            {
              id: "study-defaults-physics",
              label: "Physics Defaults",
              icon: <Magnet size={14} />,
              description: "Global Zeeman field and baseline magnetic forcing",
              active: studyNode?.kind === "study-physics-defaults",
              action: () => runCommand(p, { id: "navigation.select-node", nodeId: "study-defaults-physics" }),
            },
            {
              id: "study-defaults-outputs",
              label: "Output Defaults",
              icon: <Download size={14} />,
              description: "Artifacts, snapshots and export policy",
              active: studyNode?.kind === "study-outputs-defaults",
              action: () => runCommand(p, { id: "navigation.select-node", nodeId: "study-defaults-outputs" }),
            },
          ],
        },
        {
          id: "study-stages",
          icon: <ListChecks size={20} />,
          label: "Stages",
          tooltip: "Study stage sequence authoring",
          active:
            studyNode?.kind === "study-stages"
            || studyNode?.kind === "study-stage"
            || studyNode?.kind === "study-stage-empty",
          iconColor: "text-violet-400",
          action: () => runCommand(p, { id: "navigation.select-node", nodeId: "study-stages" }),
        },
      ],
    },
    {
      id: "study-add",
      title: "Add Stage",
      actions: [
        {
          id: "study-add-relax",
          icon: <Target size={20} />,
          label: "Relax",
          tooltip: hasStageSelection ? "Insert Relax after the selected stage" : "Append Relax at the end of the stage sequence",
          accent: true,
          iconColor: "text-emerald-400",
          disabled: !canCommand(p, { id: "study.add-primitive", kind: "relax", placement }),
          action: () => runCommand(p, { id: "study.add-primitive", kind: "relax", placement }),
        },
        {
          id: "study-add-run",
          icon: <Play size={20} />,
          label: "Run",
          tooltip: hasStageSelection ? "Insert Run after the selected stage" : "Append Run at the end of the stage sequence",
          accent: true,
          iconColor: "text-emerald-400",
          disabled: !canCommand(p, { id: "study.add-primitive", kind: "run", placement }),
          action: () => runCommand(p, { id: "study.add-primitive", kind: "run", placement }),
        },
        {
          id: "study-add-eigen",
          icon: <Sparkles size={20} />,
          label: "Eigensolve",
          tooltip: hasStageSelection ? "Insert Eigensolve after the selected stage" : "Append Eigensolve at the end of the stage sequence",
          accent: true,
          iconColor: "text-emerald-400",
          disabled: !canCommand(p, { id: "study.add-primitive", kind: "eigenmodes", placement }),
          action: () => runCommand(p, { id: "study.add-primitive", kind: "eigenmodes", placement }),
        },
      ],
    },
    {
      id: "study-composite",
      title: "Composite",
      actions: [
        {
          id: "study-add-hysteresis",
          icon: <Magnet size={20} />,
          label: "Hysteresis",
          tooltip: hasStageSelection ? "Insert Hysteresis Loop after the selected stage" : "Append Hysteresis Loop at the end of the stage sequence",
          iconColor: "text-violet-400",
          disabled: !canCommand(p, { id: "study.add-macro", kind: "hysteresis_loop", placement }),
          action: () => runCommand(p, { id: "study.add-macro", kind: "hysteresis_loop", placement }),
        },
        {
          id: "study-add-field-sweep",
          icon: <FunctionSquare size={20} />,
          label: "Sweep+Relax",
          tooltip: hasStageSelection ? "Insert Field Sweep + Relax after the selected stage" : "Append Field Sweep + Relax at the end of the stage sequence",
          iconColor: "text-violet-400",
          disabled: !canCommand(p, { id: "study.add-macro", kind: "field_sweep_relax", placement }),
          action: () => runCommand(p, { id: "study.add-macro", kind: "field_sweep_relax", placement }),
        },
        {
          id: "study-add-field-sweep-snapshot",
          icon: <FunctionSquare size={20} />,
          label: "Sweep+Snap",
          tooltip: hasStageSelection ? "Insert Field Sweep + Relax + Snapshot after the selected stage" : "Append Field Sweep + Relax + Snapshot at the end of the stage sequence",
          iconColor: "text-violet-400",
          disabled: !canCommand(p, { id: "study.add-macro", kind: "field_sweep_relax_snapshot", placement }),
          action: () => runCommand(p, { id: "study.add-macro", kind: "field_sweep_relax_snapshot", placement }),
        },
        {
          id: "study-add-relax-run",
          icon: <Layers3 size={20} />,
          label: "Relax->Run",
          tooltip: hasStageSelection ? "Insert Relax -> Run after the selected stage" : "Append Relax -> Run at the end of the stage sequence",
          iconColor: "text-violet-400",
          disabled: !canCommand(p, { id: "study.add-macro", kind: "relax_run", placement }),
          action: () => runCommand(p, { id: "study.add-macro", kind: "relax_run", placement }),
        },
        {
          id: "study-add-relax-eigen",
          icon: <Binary size={20} />,
          label: "Relax->Eigen",
          tooltip: hasStageSelection ? "Insert Relax -> Eigensolve after the selected stage" : "Append Relax -> Eigensolve at the end of the stage sequence",
          iconColor: "text-violet-400",
          disabled: !canCommand(p, { id: "study.add-macro", kind: "relax_eigenmodes", placement }),
          action: () => runCommand(p, { id: "study.add-macro", kind: "relax_eigenmodes", placement }),
        },
        {
          id: "study-add-parameter-sweep",
          icon: <FunctionSquare size={20} />,
          label: "Param Sweep",
          tooltip: hasStageSelection ? "Insert Parameter Sweep after the selected stage" : "Append Parameter Sweep at the end of the stage sequence",
          iconColor: "text-violet-400",
          disabled: !canCommand(p, { id: "study.add-macro", kind: "parameter_sweep", placement }),
          action: () => runCommand(p, { id: "study.add-macro", kind: "parameter_sweep", placement }),
        },
      ],
    },
    {
      id: "study-selection",
      title: "Selection",
      actions: [
        {
          id: "study-duplicate",
          icon: <Plus size={20} />,
          label: "Duplicate",
          tooltip: hasStageSelection ? "Duplicate the selected stage node" : "Select a stage node to duplicate it",
          disabled: !hasStageSelection || !canCommand(p, { id: "study.duplicate-selected" }),
          action: () => runCommand(p, { id: "study.duplicate-selected" }),
          iconColor: "text-amber-400",
        },
        {
          id: "study-toggle",
          icon: <RefreshCw size={20} />,
          label: "Enable",
          tooltip: hasStageSelection ? "Enable or disable the selected stage node" : "Select a stage node to toggle it",
          disabled: !hasStageSelection || !canCommand(p, { id: "study.toggle-selected-enabled" }),
          action: () => runCommand(p, { id: "study.toggle-selected-enabled" }),
          iconColor: "text-slate-400",
        },
      ],
    },
    {
      id: "builder-sync",
      title: "Sync",
      actions: [
        {
          id: "builder-sync-script",
          icon: <RefreshCw size={20} className={cn(p.scriptSyncBusy && "animate-spin")} />,
          label: p.scriptSyncBusy ? "Syncing..." : "Sync Script",
          tooltip: "Rewrite the Python script from the current builder state",
          accent: true,
          disabled: !canCommand(p, { id: "script.sync" }),
          action: () => runCommand(p, { id: "script.sync" }),
        },
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
        disabled: !target.available || !canCommand(p, { id: "preview.select-quantity", quantityId: target.id }),
        iconColor,
        action: () => runCommand(p, { id: "preview.select-quantity", quantityId: target.id }),
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
        {
          id: "plot",
          icon: <BarChart3 size={20} />,
          label: "Chart",
          tooltip: "Open scalar plot",
          action: () => runCommand(p, { id: "viewport.set-mode", mode: "charts" }),
          iconColor: "text-emerald-400",
        },
        {
          id: "snapshot",
          icon: <Camera size={20} />,
          label: "Capture",
          tooltip: "Take viewport screenshot",
          disabled: !canCommand(p, { id: "capture.viewport" }),
          action: () => runCommand(p, { id: "capture.viewport" }),
          iconColor: "text-violet-400",
        },
        {
          id: "exportvtk",
          icon: <Download size={20} />,
          label: "VTK",
          tooltip: "Export VTK",
          disabled: !canCommand(p, { id: "export.results" }),
          action: () => runCommand(p, { id: "export.results" }),
          iconColor: "text-blue-400",
        },
        {
          id: "save-state",
          icon: <Save size={20} />,
          label: "State",
          tooltip: "Download magnetization state (JSON)",
          disabled: !canCommand(p, { id: "export.state" }),
          action: () => runCommand(p, { id: "export.state" }),
          iconColor: "text-emerald-400",
        },
      ],
    },
    {
      id: "analyze", title: "Analyze",
      actions: [
        {
          id: "analyze-spectrum",
          icon: <BarChart3 size={20} />,
          label: "Spectrum",
          tooltip: "Eigenmode spectrum & mode inspector",
          active: p.viewMode === "Analyze",
          action: () => runCommand(p, { id: "viewport.set-mode", mode: "Analyze" }),
          iconColor: "text-violet-400",
        },
      ],
    },
    buildViewGroup(p),
  ];
}

function buildAutomationGroups(p: RibbonBarProps): RibbonGroup[] {
  return [
    {
      id: "automation-sync",
      title: "Automation",
      actions: [
        {
          id: "automation-sync-script",
          icon: <RefreshCw size={20} className={cn(p.scriptSyncBusy && "animate-spin")} />,
          label: p.scriptSyncBusy ? "Syncing..." : "Sync Script",
          tooltip: "Rewrite Python script from current builder model",
          accent: true,
          disabled: !canCommand(p, { id: "script.sync" }),
          action: () => runCommand(p, { id: "script.sync" }),
        },
        {
          id: "automation-export-state",
          icon: <Save size={20} />,
          label: "Export State",
          tooltip: "Save current magnetization state (JSON)",
          disabled: !canCommand(p, { id: "export.state" }),
          action: () => runCommand(p, { id: "export.state" }),
          iconColor: "text-emerald-400",
        },
        {
          id: "automation-export-vtk",
          icon: <Download size={20} />,
          label: "Export VTK",
          tooltip: "Export solver data for post-processing",
          disabled: !canCommand(p, { id: "export.results" }),
          action: () => runCommand(p, { id: "export.results" }),
          iconColor: "text-cyan-400",
        },
      ],
    },
    buildViewGroup(p),
  ];
}

function buildContextualGroups(
  p: RibbonBarProps,
  contextualTab: ContextualRibbonTab["id"] | null,
): RibbonGroup[] {
  const objectId = p.selectedObjectId ?? "";
  if (contextualTab === "selected-ferromagnet" && objectId) {
    return [
      {
        id: "ctx-ferromagnet",
        title: "Selected Ferromagnet",
        actions: [
          {
            id: "ctx-open-material",
            icon: <FlaskConical size={20} />,
            label: "Material",
            tooltip: "Open material constants for selected ferromagnet",
            action: () => runCommand(p, { id: "navigation.select-node", nodeId: `mat-${objectId}` }),
            iconColor: "text-amber-400",
          },
          {
            id: "ctx-open-physics",
            icon: <Magnet size={20} />,
            label: "Interactions",
            tooltip: "Open magnetic interactions stack",
            action: () => runCommand(p, { id: "navigation.select-node", nodeId: `physobj-${objectId}` }),
            iconColor: "text-violet-400",
          },
          {
            id: "ctx-add-dmi",
            icon: <Sparkles size={20} />,
            label: "Add DMI",
            tooltip: "Add interfacial DMI interaction",
            disabled: !canCommand(p, {
              id: "object.add-interaction",
              objectId,
              kind: "interfacial_dmi",
            }),
            action: () => runCommand(p, {
              id: "object.add-interaction",
              objectId,
              kind: "interfacial_dmi",
            }),
            iconColor: "text-cyan-400",
          },
          {
            id: "ctx-add-ku",
            icon: <Binary size={20} />,
            label: "Add Ku",
            tooltip: "Add uniaxial anisotropy interaction",
            disabled: !canCommand(p, {
              id: "object.add-interaction",
              objectId,
              kind: "uniaxial_anisotropy",
            }),
            action: () => runCommand(p, {
              id: "object.add-interaction",
              objectId,
              kind: "uniaxial_anisotropy",
            }),
            iconColor: "text-rose-400",
          },
        ],
      },
    ];
  }
  if (contextualTab === "mesh-quality") {
    return [
      {
        id: "ctx-mesh-quality",
        title: "Mesh Quality",
        actions: [
          {
            id: "ctx-mesh-open-quality",
            icon: <BarChart3 size={20} />,
            label: "Quality",
            tooltip: "Open mesh quality diagnostics",
            disabled: !canCommand(p, { id: "mesh.open-quality" }),
            action: () => runCommand(p, { id: "mesh.open-quality" }),
            iconColor: "text-emerald-400",
          },
          {
            id: "ctx-mesh-open-pipeline",
            icon: <ListChecks size={20} />,
            label: "Pipeline",
            tooltip: "Open mesh pipeline diagnostics",
            disabled: !canCommand(p, { id: "mesh.open-pipeline" }),
            action: () => runCommand(p, { id: "mesh.open-pipeline" }),
            iconColor: "text-amber-400",
          },
          {
            id: "ctx-mesh-build",
            icon: <RefreshCw size={20} className={cn(p.meshGenerating && "animate-spin")} />,
            label: p.meshGenerating ? "Building..." : "Rebuild",
            tooltip: "Rebuild selected mesh target",
            disabled: !canCommand(p, { id: "mesh.build-selected" }),
            action: () => runCommand(p, { id: "mesh.build-selected" }),
            accent: true,
          },
        ],
      },
    ];
  }
  if (contextualTab === "interface") {
    return [
      {
        id: "ctx-interface",
        title: "Interface",
        actions: [
          {
            id: "ctx-interface-coupling",
            icon: <Layers3 size={20} />,
            label: "Coupling",
            tooltip: "Interface coupling authoring will land in next pass",
            disabled: true,
            iconColor: "text-slate-400",
          },
          {
            id: "ctx-interface-bc",
            icon: <Target size={20} />,
            label: "Boundary BC",
            tooltip: "Boundary condition authoring will land in next pass",
            disabled: true,
            iconColor: "text-slate-400",
          },
        ],
      },
    ];
  }
  if (contextualTab === "work-plane") {
    return [
      {
        id: "ctx-work-plane",
        title: "Work Plane",
        actions: [
          {
            id: "ctx-work-plane-transform",
            icon: <Ruler size={20} />,
            label: "Transform",
            tooltip: "Work-plane transform tools will land in next pass",
            disabled: true,
            iconColor: "text-slate-400",
          },
          {
            id: "ctx-work-plane-sketch",
            icon: <Shapes size={20} />,
            label: "Sketch",
            tooltip: "Sketch tools will land in next pass",
            disabled: true,
            iconColor: "text-slate-400",
          },
        ],
      },
    ];
  }
  if (contextualTab === "plot") {
    const firstAvailable = (p.quickPreviewTargets ?? []).find((target) => target.available);
    return [
      {
        id: "ctx-plot",
        title: "Plot",
        actions: [
          {
            id: "ctx-plot-quantity",
            icon: <Eye size={20} />,
            label: firstAvailable?.shortLabel ?? "Quantity",
            tooltip: "Switch to first available quantity",
            disabled: !firstAvailable || !canCommand(p, {
              id: "preview.select-quantity",
              quantityId: firstAvailable?.id ?? "m",
            }),
            action: () => {
              if (!firstAvailable) return;
              runCommand(p, { id: "preview.select-quantity", quantityId: firstAvailable.id });
            },
            iconColor: "text-sky-400",
          },
          {
            id: "ctx-plot-capture",
            icon: <Camera size={20} />,
            label: "Capture",
            tooltip: "Capture current plot/viewport",
            disabled: !canCommand(p, { id: "capture.viewport" }),
            action: () => runCommand(p, { id: "capture.viewport" }),
            iconColor: "text-violet-400",
          },
          {
            id: "ctx-plot-export",
            icon: <Download size={20} />,
            label: "Export",
            tooltip: "Export current results",
            disabled: !canCommand(p, { id: "export.results" }),
            action: () => runCommand(p, { id: "export.results" }),
            iconColor: "text-cyan-400",
          },
        ],
      },
    ];
  }
  if (contextualTab === "table") {
    return [
      {
        id: "ctx-table",
        title: "Table",
        actions: [
          {
            id: "ctx-table-open",
            icon: <Columns2 size={20} />,
            label: "Table View",
            tooltip: "Table tooling will be moved here in next pass",
            disabled: true,
            iconColor: "text-slate-400",
          },
          {
            id: "ctx-table-export",
            icon: <Download size={20} />,
            label: "Export CSV",
            tooltip: "CSV export policy will be wired to results tables",
            disabled: true,
            iconColor: "text-slate-400",
          },
        ],
      },
    ];
  }
  return [];
}

function buildViewGroup(p: RibbonBarProps): RibbonGroup {
  return {
    id: "view", title: "View",
    actions: [
      {
        id: "3d",
        icon: <Box size={20} />,
        label: "3D",
        tooltip: "3D view",
        shortcut: "1",
        active: p.viewMode === "3D",
        action: () => runCommand(p, { id: "viewport.set-mode", mode: "3D" }),
        iconColor: "text-indigo-400",
      },
      {
        id: "2d",
        icon: <Columns2 size={20} />,
        label: "2D",
        tooltip: "2D view",
        shortcut: "2",
        active: p.viewMode === "2D",
        action: () => runCommand(p, { id: "viewport.set-mode", mode: "2D" }),
        iconColor: "text-sky-400",
      },
      {
        id: "mesh-view",
        icon: <Grid3X3 size={20} />,
        label: "Mesh",
        tooltip: "Mesh view",
        shortcut: "3",
        active: p.viewMode === "Mesh",
        action: () => runCommand(p, { id: "viewport.set-mode", mode: "Mesh" }),
        iconColor: "text-fuchsia-400",
      },
      {
        id: "visualization-preset",
        icon: <Sparkles size={20} />,
        label: "3D Visual",
        tooltip: "Create new visualization preset",
        disabled: !canCommand(p, { id: "visualization.create-preset" }),
        action: () => runCommand(p, { id: "visualization.create-preset" }),
        iconColor: "text-amber-300",
      },
      {
        id: "sidebar",
        icon: <PanelRight size={20} />,
        label: "Panel",
        tooltip: "Toggle sidebar",
        shortcut: "Ctrl+B",
        active: p.sidebarVisible,
        disabled: !canCommand(p, { id: "viewport.toggle-sidebar" }),
        action: () => runCommand(p, { id: "viewport.toggle-sidebar" }),
        iconColor: "text-slate-400",
      },
      {
        id: "eye",
        icon: <Eye size={20} />,
        label: "Focus",
        tooltip: p.selectedObjectId ? "Focus camera on selected object" : "Select an object to focus",
        disabled: !canCommand(p, { id: "viewport.focus-selected-object" }),
        iconColor: "text-teal-400",
        action: () => runCommand(p, { id: "viewport.focus-selected-object" }),
      },
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
  const propsOnClick = props.onClick;
  const handleClick = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    propsOnClick?.(e);
    if (e.defaultPrevented) {
      return;
    }
    action.action?.();
  }, [action, propsOnClick]);
  return (
    <button
      ref={ref}
      {...props}
      className={cn(
        "flex min-h-[52px] min-w-[58px] flex-col items-center justify-center gap-1 rounded-md border p-1 transition-all",
        action.active
          ? "border-primary/20 bg-primary/10 text-primary shadow-inner"
          : action.accent
            ? "border-transparent bg-primary text-primary-foreground shadow-sm hover:bg-primary/90"
            : "border-transparent text-foreground hover:border-border/50 hover:bg-muted/80",
        previewPending && action.active && "animate-pulse shadow-[0_0_0_1px_rgba(99,102,241,0.35)]",
        action.disabled && "pointer-events-none cursor-not-allowed opacity-40",
        props.className,
      )}
      disabled={action.disabled}
      onClick={handleClick}
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
          "text-[0.62rem] font-medium leading-none text-center",
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

/** Map workspace mode to its default ribbon tab (when no manual override). */
function defaultTabForMode(mode: WorkspaceMode | undefined): RibbonTab {
  switch (mode) {
    case "build": return "Geometry";
    case "study": return "Study";
    case "analyze":
    default: return "Results";
  }
}

function ribbonTabLabel(tab: RibbonTab): string {
  return tab;
}

/* ── Component ──────────────────────────────────── */

export default function RibbonBar(props: RibbonBarProps) {
  const currentStage = useWorkspaceStore((s) => s.currentStage);
  const activeCoreTab = useWorkspaceStore((s) => s.activeCoreTab);
  const setActiveCoreTab = useWorkspaceStore((s) => s.setActiveCoreTab);
  const activeContextualTab = useWorkspaceStore((s) => s.activeContextualTab);
  const setActiveContextualTab = useWorkspaceStore((s) => s.setActiveContextualTab);
  const workspaceStage = props.workspaceMode ?? currentStage;
  const visibleTabs = useMemo(() => tabsForMode(workspaceStage), [workspaceStage]);
  const defaultTab = defaultTabForMode(workspaceStage);
  const studyNode = useMemo(() => parseStudyNodeContext(props.selectedNodeId), [props.selectedNodeId]);
  const contextualTabs = useMemo(
    () => contextualTabsForSelection(props),
    [props],
  );
  const activeTab = (activeCoreTab && visibleTabs.includes(activeCoreTab as RibbonTab)
    ? (activeCoreTab as RibbonTab)
    : defaultTab);

  useEffect(() => {
    if (!activeCoreTab || !visibleTabs.includes(activeCoreTab as RibbonTab)) {
      setActiveCoreTab(defaultTab);
    }
  }, [activeCoreTab, defaultTab, setActiveCoreTab, visibleTabs]);

  useEffect(() => {
    if (contextualTabs.length === 0) {
      if (activeContextualTab !== null) {
        setActiveContextualTab(null);
      }
      return;
    }
    if (!activeContextualTab || !contextualTabs.some((tab) => tab.id === activeContextualTab)) {
      setActiveContextualTab(contextualTabs[0]?.id ?? null);
    }
  }, [activeContextualTab, contextualTabs, setActiveContextualTab]);

  const groups = useMemo(() => {
    let baseGroups: RibbonGroup[];
    switch (activeTab) {
      case "Definitions":
        baseGroups = buildDefinitionsGroups(props);
        break;
      case "Geometry":
        baseGroups = buildGeometryGroups(props);
        break;
      case "Materials":
        baseGroups = buildMaterialsGroups(props);
        break;
      case "Physics":
        baseGroups = buildPhysicsGroups(props);
        break;
      case "Mesh":
        baseGroups = buildMeshGroups(props);
        break;
      case "Study":
        baseGroups = buildStudyBuilderGroups(props, studyNode);
        break;
      case "Results":
        baseGroups = buildResultsGroups(props);
        break;
      case "Automation":
        baseGroups = buildAutomationGroups(props);
        break;
      default:
        baseGroups = buildHomeGroups(props);
        break;
    }
    const contextualGroups = buildContextualGroups(
      props,
      (activeContextualTab as ContextualRibbonTab["id"] | null) ?? null,
    );
    return contextualGroups.length > 0 ? [...baseGroups, ...contextualGroups] : baseGroups;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeTab,
    activeContextualTab,
    props.workspaceMode,
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
    props.canSyncScriptBuilder,
    props.scriptSyncBusy,
    props.selectedObjectId,
    props.onStudyAddPrimitive,
    props.onStudyAddMacro,
    props.onStudyDuplicateSelected,
    props.onStudyToggleSelectedEnabled,
    props.onObjectAddInteraction,
    studyNode,
  ]);

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex flex-col w-full bg-card/10 border-b border-border/15 backdrop-blur-xl shrink-0 z-30">
        {/* ── Tab row ── */}
        <div className="flex px-3 pt-2 gap-1 border-b border-border/10">
          {visibleTabs.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveCoreTab(tab)}
              className={cn(
                "px-4 py-2 min-w-[72px] text-[0.78rem] font-medium transition-colors rounded-t-lg border-b-2 font-sans cursor-pointer hover:bg-muted/30",
                tab === activeTab 
                  ? "border-primary bg-primary/10 text-primary" 
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              {ribbonTabLabel(tab)}
            </button>
          ))}
          {contextualTabs.length > 0 ? (
            <div className="ml-auto mb-2 flex items-center gap-1.5 pl-4">
              <span className="text-[0.6rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground/80">
                Context
              </span>
              {contextualTabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  className={cn(
                    "rounded-md border px-2 py-1 text-[0.63rem] font-semibold tracking-wide transition-colors",
                    activeContextualTab === tab.id
                      ? "border-primary/30 bg-primary/12 text-primary"
                      : "border-border/30 bg-background/30 text-muted-foreground hover:bg-muted/40 hover:text-foreground",
                  )}
                  onClick={() => setActiveContextualTab(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          ) : null}
          {activeTab === "Mesh" && (
            <div className={cn(
              "mb-2 flex items-center gap-2 pl-4",
              contextualTabs.length > 0 ? "border-l border-border/20 ml-1" : "ml-auto",
            )}>
              <span className="text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground/80">
                Mesh Status
              </span>
              <span
                className={cn(
                  "rounded-md border px-2 py-1 text-[0.68rem] font-medium",
                  props.meshGenerating
                    ? "border-cyan-400/30 bg-cyan-400/10 text-cyan-200"
                    : props.meshConfigDirty
                      ? "border-amber-400/30 bg-amber-400/10 text-amber-200"
                      : "border-emerald-400/25 bg-emerald-400/10 text-emerald-200",
                )}
              >
                {props.meshGenerating
                  ? "Building"
                  : props.meshConfigDirty
                    ? "Out of date"
                    : "Up to date"}
              </span>
              <span className="text-[0.7rem] text-muted-foreground">
                {props.meshGenerating
                  ? "The build modal is streaming live meshing progress."
                  : props.meshConfigDirty
                    ? "Viewport shows the last built mesh until you rebuild."
                    : "Viewport reflects the latest built mesh."}
              </span>
            </div>
          )}
        </div>

        {/* ── Actions row ── */}
        <div className="flex items-stretch overflow-x-auto scrollbar-none py-2 px-2 gap-1 min-h-[88px]">
          {groups.filter((g) => g.actions.some((a) => !a.hidden)).map((group, gi) => (
            <div key={group.id} className="flex items-stretch shrink-0">
              {gi > 0 && <div className="w-px bg-border/40 mx-2 self-stretch my-3 shadow-[1px_0_0_hsla(0,0%,100%,0.02)]" />}
              <div className="flex flex-col justify-between items-center px-1 shrink-0">
                <div className="flex items-center gap-1">
                  {group.actions.filter((a) => !a.hidden).map((action) =>
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
                            {action.menuItems.filter((it) => !it.hidden).map((item) =>
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
