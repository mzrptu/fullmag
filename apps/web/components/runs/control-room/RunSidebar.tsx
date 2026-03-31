"use client";

import { useCallback, useMemo, useState } from "react";
import {
  Panel,
  Group as PanelGroup,
  Separator as PanelResizeHandle,
  usePanelRef,
  type PanelSize,
} from "react-resizable-panels";
import ModelTree, { buildFullmagModelTree } from "../../panels/ModelTree";
import SettingsPanel from "../../panels/SettingsPanel";
import { useCommand, useModel, useTransport, useViewport } from "./ControlRoomContext";
import { findTreeNodeById, previewQuantityForTreeNode } from "./shared";
import { meshWorkspaceNodeToDockTab, meshWorkspaceNodeToPreset } from "./meshWorkspace";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

/**
 * RunSidebar — horizontal two-column Master-Detail layout.
 * Column 1 (narrow): Model Builder tree — always visible, serves as the
 *   navigation spine of the project.
 * Column 2 (wider):  Inspector / SettingsPanel — shows contextual properties
 *   for whichever tree node is selected.
 */
export default function RunSidebar() {
  const model = useModel();
  const cmd = useCommand();
  const tp = useTransport();
  const vp = useViewport();
  const treePanelRef = usePanelRef();
  const inspectorPanelRef = usePanelRef();
  const [treeOpen, setTreeOpen] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(true);

  /* ── Build model tree nodes ── */
  const modelTreeNodes = useMemo(
    () =>
      buildFullmagModelTree({
        backend: cmd.isFemBackend ? "FEM" : "FDM",
        geometryKind: model.mesherSourceKind ?? undefined,
        materialName:
          model.material?.name
            ?? (model.material?.msat != null ? `Msat=${(model.material.msat / 1e3).toFixed(0)} kA/m` : undefined),
        materialMsat: model.material?.msat,
        materialAex: model.material?.aex,
        materialAlpha: model.material?.alpha,
        meshStatus: model.effectiveFemMesh ? "ready" : "pending",
        meshElements: model.effectiveFemMesh?.elements.length,
        meshNodes: model.effectiveFemMesh?.nodes.length,
        meshFeOrder: model.meshFeOrder,
        meshName: model.meshName,
        solverStatus: tp.hasSolverTelemetry ? "active" : "pending",
        solverIntegrator: model.solverPlan?.integrator ?? model.solverSettings.integrator,
        solverRelaxAlgorithm: model.solverPlan?.relaxation?.algorithm ?? model.solverSettings.relaxAlgorithm,
        demagMethod: "transfer-grid",
        exchangeEnabled: model.material?.exchangeEnabled,
        demagEnabled: model.material?.demagEnabled,
        zeemanField: model.material?.zeemanField,
        convergenceStatus:
          tp.hasSolverTelemetry && tp.effectiveDmDt > 0 && tp.effectiveDmDt < (Number(model.solverSettings.torqueTolerance) || 1e-5)
            ? "ready"
            : tp.hasSolverTelemetry
              ? "active"
              : undefined,
        scalarRowCount: tp.scalarRows.length,
        initialStatePath: cmd.scriptInitialState?.source_path ?? null,
        initialStateFormat: cmd.scriptInitialState?.format ?? null,
      }),
    [
      model.effectiveFemMesh, tp.hasSolverTelemetry, cmd.isFemBackend, model.material,
      model.mesherSourceKind, model.meshFeOrder, model.meshName,
      model.solverPlan?.integrator, model.solverPlan?.relaxation?.algorithm,
      model.solverSettings.integrator, model.solverSettings.relaxAlgorithm,
      tp.effectiveDmDt, tp.scalarRows.length, cmd.scriptInitialState,
    ],
  );

  /* ── Determine active node (from explicit selection or viewport context) ── */
  const fallbackNodeId = useMemo(() => {
    const isMeshView = cmd.isFemBackend && vp.effectiveViewMode === "Mesh";
    if (isMeshView) {
      if (model.femDockTab === "quality") return "mesh-quality";
      if (model.femDockTab === "pipeline") return "mesh-pipeline";
      if (model.femDockTab === "view") return "mesh-view";
      if (model.femDockTab === "mesher") return "mesh-size";
      return "mesh";
    }
    if (vp.previewControlsActive) return "res-fields";
    if (cmd.interactiveControlsEnabled) return "study-solver";
    if (model.material) return "materials";
    return "geometry";
  }, [vp.effectiveViewMode, model.femDockTab, cmd.interactiveControlsEnabled,
      cmd.isFemBackend, model.material, vp.previewControlsActive]);

  const activeNodeId = model.selectedSidebarNodeId ?? fallbackNodeId;
  const activeNode = useMemo(
    () => findTreeNodeById(modelTreeNodes, activeNodeId),
    [activeNodeId, modelTreeNodes],
  );

  /* ── Tree click handler ── */
  const handleTreeClick = useCallback((id: string) => {
    model.setSelectedSidebarNodeId(id);
    // Ensure inspector is visible when a node is clicked
    const panel = inspectorPanelRef.current;
    if (panel?.isCollapsed()) {
      panel.expand();
      setInspectorOpen(true);
    }
    switch (id) {
      case "geometry": case "geo-body": case "regions": case "reg-domain": case "reg-boundary":
        if (cmd.isFemBackend) model.openFemMeshWorkspace("mesh");
        else vp.setViewMode("3D");
        return;
      case "mesh":
      case "mesh-view":
      case "mesh-size":
      case "mesh-algorithm":
      case "mesh-quality":
      case "mesh-pipeline": {
        if (!cmd.isFemBackend) return;
        const preset = meshWorkspaceNodeToPreset(id);
        if (preset) {
          model.applyMeshWorkspacePreset(preset);
          return;
        }
        const dockTab = meshWorkspaceNodeToDockTab(id);
        if (dockTab) {
          model.openFemMeshWorkspace(dockTab);
        }
        return;
      }
      case "results": case "res-fields":
        if (cmd.isFemBackend && vp.effectiveViewMode === "Mesh") vp.setViewMode("3D");
        return;
      default: {
        const previewTarget = previewQuantityForTreeNode(id);
        if (previewTarget && vp.quickPreviewTargets.some((t) => t.id === previewTarget && t.available)) {
          vp.requestPreviewQuantity(previewTarget);
        }
      }
    }
  }, [cmd.isFemBackend, model, vp, inspectorPanelRef]);

  const handleTreeToggle = useCallback(() => {
    const panel = treePanelRef.current;
    if (!panel) return;
    if (panel.isCollapsed()) {
      panel.expand();
      setTreeOpen(true);
    } else {
      panel.collapse();
      setTreeOpen(false);
    }
  }, [treePanelRef]);

  const handleInspectorToggle = useCallback(() => {
    const panel = inspectorPanelRef.current;
    if (!panel) return;
    if (panel.isCollapsed()) {
      panel.expand();
      setInspectorOpen(true);
    } else {
      panel.collapse();
      setInspectorOpen(false);
    }
  }, [inspectorPanelRef]);

  const handleTreeResize = useCallback((panelSize: PanelSize) => {
    setTreeOpen(panelSize.inPixels > 68);
  }, []);

  const handleInspectorResize = useCallback((panelSize: PanelSize) => {
    setInspectorOpen(panelSize.inPixels > 68);
  }, []);

  return (
    <div className="flex w-full h-full border-l border-white/5 bg-gradient-to-br from-card/60 to-background/40 backdrop-blur-2xl shadow-[-8px_0_32px_rgba(0,0,0,0.4)] z-30">
      <PanelGroup
        orientation="horizontal"
        className="flex w-full h-full"
        resizeTargetMinimumSize={{ coarse: 32, fine: 10 }}
      >
        {/* ── Column 1: Model Builder Tree ── */}
        <Panel
          id="sidebar-model-tree"
          defaultSize={40}
          minSize={20}
          collapsible
          collapsedSize={4}
          panelRef={treePanelRef}
          onResize={handleTreeResize}
        >
          <section className="flex flex-col h-full bg-transparent border-r border-border/20">
            <button
              type="button"
              className="flex items-center w-full px-3 py-2.5 text-left transition-colors hover:bg-muted/50 border-b border-white/5 border-l-[3px] border-l-primary z-10 shrink-0 relative"
              onClick={handleTreeToggle}
              aria-expanded={treeOpen}
            >
              <span className={cn("text-primary/70 mr-2 font-black transition-transform duration-150 flex items-center justify-center w-4 h-4 text-[10px]", treeOpen && "rotate-90")}>▸</span>
              <span className="text-[0.65rem] font-medium uppercase tracking-wider text-foreground">Model</span>
              <span className="ml-auto text-[0.6rem] font-mono tracking-tight text-primary-foreground bg-primary/80 px-1.5 py-0.5 rounded-sm">{cmd.isFemBackend ? "FEM" : "FDM"}</span>
            </button>
            {treeOpen && (
              <div className="flex-1 min-h-0 min-w-0 pr-1 overflow-hidden isolate relative">
                <ScrollArea className="h-full w-full">
                  <div className="p-2 select-none">
                    <ModelTree nodes={modelTreeNodes} activeId={activeNodeId} onNodeClick={handleTreeClick} />
                  </div>
                </ScrollArea>
              </div>
            )}
          </section>
        </Panel>

        {/* ── Resize handle (vertical divider) ── */}
        <PanelResizeHandle className="flex shrink-0 items-center justify-center bg-transparent w-1.5 cursor-col-resize relative z-10 hover:bg-primary/20 transition-colors after:absolute after:inset-y-0 after:left-1/2 after:-translate-x-1/2 after:w-px after:h-8 after:my-auto after:bg-border/60 hover:after:bg-primary" />

        {/* ── Column 2: Inspector / SettingsPanel ── */}
        <Panel
          id="sidebar-inspector"
          defaultSize={60}
          minSize={25}
          collapsible
          collapsedSize={4}
          panelRef={inspectorPanelRef}
          onResize={handleInspectorResize}
        >
          <section className="flex flex-col h-full bg-transparent">
            <button
              type="button"
              className="flex items-center w-full px-3 py-2.5 text-left transition-colors hover:bg-muted/50 border-b border-white/5 border-l-[3px] border-l-emerald-500 z-10 shrink-0 relative"
              onClick={handleInspectorToggle}
              aria-expanded={inspectorOpen}
            >
              <span className={cn("text-emerald-500/70 mr-2 font-black transition-transform duration-150 flex items-center justify-center w-4 h-4 text-[10px]", inspectorOpen && "rotate-90")}>▸</span>
              <span className="text-[0.65rem] font-medium uppercase tracking-wider text-foreground">
                Inspector
              </span>
              <span className="ml-auto text-[0.6rem] font-mono tracking-tight text-muted-foreground bg-emerald-500/10 px-1.5 py-0.5 rounded-sm border border-emerald-500/20">
                {activeNode?.label ?? "Workspace"}
              </span>
            </button>
            {inspectorOpen && (
              <div className="flex-1 min-h-0 min-w-0 overflow-hidden isolate relative">
                <ScrollArea className="h-full w-full">
                  <div className="p-0 select-none">
                    <SettingsPanel nodeId={activeNodeId} nodeLabel={activeNode?.label ?? null} />
                  </div>
                </ScrollArea>
              </div>
            )}
          </section>
        </Panel>
      </PanelGroup>
    </div>
  );
}
