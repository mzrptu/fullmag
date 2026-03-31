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
import { useControlRoom } from "./ControlRoomContext";
import { findTreeNodeById, previewQuantityForTreeNode } from "./shared";
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
  const ctx = useControlRoom();
  const treePanelRef = usePanelRef();
  const inspectorPanelRef = usePanelRef();
  const [treeOpen, setTreeOpen] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(true);

  /* ── Build model tree nodes ── */
  const modelTreeNodes = useMemo(
    () =>
      buildFullmagModelTree({
        backend: ctx.isFemBackend ? "FEM" : "FDM",
        geometryKind: ctx.mesherSourceKind ?? undefined,
        materialName:
          ctx.material?.name
            ?? (ctx.material?.msat != null ? `Msat=${(ctx.material.msat / 1e3).toFixed(0)} kA/m` : undefined),
        materialMsat: ctx.material?.msat,
        materialAex: ctx.material?.aex,
        materialAlpha: ctx.material?.alpha,
        meshStatus: ctx.effectiveFemMesh ? "ready" : "pending",
        meshElements: ctx.effectiveFemMesh?.elements.length,
        meshNodes: ctx.effectiveFemMesh?.nodes.length,
        meshFeOrder: ctx.meshFeOrder,
        meshName: ctx.meshName,
        solverStatus: ctx.hasSolverTelemetry ? "active" : "pending",
        solverIntegrator: ctx.solverPlan?.integrator ?? ctx.solverSettings.integrator,
        solverRelaxAlgorithm: ctx.solverPlan?.relaxation?.algorithm ?? ctx.solverSettings.relaxAlgorithm,
        demagMethod: "transfer-grid",
        exchangeEnabled: ctx.material?.exchangeEnabled,
        demagEnabled: ctx.material?.demagEnabled,
        zeemanField: ctx.material?.zeemanField,
        convergenceStatus:
          ctx.hasSolverTelemetry && ctx.effectiveDmDt > 0 && ctx.effectiveDmDt < (Number(ctx.solverSettings.torqueTolerance) || 1e-5)
            ? "ready"
            : ctx.hasSolverTelemetry
              ? "active"
              : undefined,
        scalarRowCount: ctx.scalarRows.length,
        initialStatePath: ctx.scriptInitialState?.source_path ?? null,
        initialStateFormat: ctx.scriptInitialState?.format ?? null,
      }),
    [
      ctx.effectiveFemMesh, ctx.hasSolverTelemetry, ctx.isFemBackend, ctx.material,
      ctx.mesherSourceKind, ctx.meshFeOrder, ctx.meshName,
      ctx.solverPlan?.integrator, ctx.solverPlan?.relaxation?.algorithm,
      ctx.solverSettings.integrator, ctx.solverSettings.relaxAlgorithm,
      ctx.effectiveDmDt, ctx.scalarRows.length, ctx.scriptInitialState,
    ],
  );

  /* ── Determine active node (from explicit selection or viewport context) ── */
  const fallbackNodeId = useMemo(() => {
    const isMeshView = ctx.isFemBackend && ctx.effectiveViewMode === "Mesh";
    if (isMeshView) {
      if (ctx.femDockTab === "quality") return "mesh-quality";
      if (ctx.femDockTab === "mesher") return "mesh-size";
      return "mesh";
    }
    if (ctx.previewControlsActive) return "res-fields";
    if (ctx.interactiveControlsEnabled) return "study-solver";
    if (ctx.material) return "materials";
    return "geometry";
  }, [ctx.effectiveViewMode, ctx.femDockTab, ctx.interactiveControlsEnabled,
      ctx.isFemBackend, ctx.material, ctx.previewControlsActive]);

  const activeNodeId = ctx.selectedSidebarNodeId ?? fallbackNodeId;
  const activeNode = useMemo(
    () => findTreeNodeById(modelTreeNodes, activeNodeId),
    [activeNodeId, modelTreeNodes],
  );

  /* ── Tree click handler ── */
  const handleTreeClick = useCallback((id: string) => {
    ctx.setSelectedSidebarNodeId(id);
    // Ensure inspector is visible when a node is clicked
    const panel = inspectorPanelRef.current;
    if (panel?.isCollapsed()) {
      panel.expand();
      setInspectorOpen(true);
    }
    switch (id) {
      case "geometry": case "geo-body": case "regions": case "reg-domain": case "reg-boundary":
        if (ctx.isFemBackend) ctx.openFemMeshWorkspace("mesh");
        else ctx.setViewMode("3D");
        return;
      case "mesh":
        if (ctx.isFemBackend) ctx.openFemMeshWorkspace("mesh");
        return;
      case "mesh-size": case "mesh-algorithm":
        if (ctx.isFemBackend) {
          ctx.setViewMode("Mesh");
          ctx.setFemDockTab("mesher");
          ctx.setMeshRenderMode((c) => (c === "surface" ? "surface+edges" : c));
        }
        return;
      case "mesh-quality":
        if (ctx.isFemBackend) ctx.openFemMeshWorkspace("quality");
        return;
      case "results": case "res-fields":
        if (ctx.isFemBackend && ctx.effectiveViewMode === "Mesh") ctx.setViewMode("3D");
        return;
      default: {
        const previewTarget = previewQuantityForTreeNode(id);
        if (previewTarget && ctx.quickPreviewTargets.some((t) => t.id === previewTarget && t.available)) {
          ctx.requestPreviewQuantity(previewTarget);
        }
      }
    }
  }, [ctx, inspectorPanelRef]);

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
              <span className="ml-auto text-[0.6rem] font-mono tracking-tight text-primary-foreground bg-primary/80 px-1.5 py-0.5 rounded-sm">{ctx.isFemBackend ? "FEM" : "FDM"}</span>
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
