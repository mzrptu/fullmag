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
 * RunSidebar — two-zone panel: narrow ModelTree + wider SettingsPanel.
 * All data consumed via useControlRoom() — zero prop drilling.
 */
export default function RunSidebar() {
  const ctx = useControlRoom();
  const navigatorPanelRef = usePanelRef();
  const inspectorPanelRef = usePanelRef();
  const [navigatorOpen, setNavigatorOpen] = useState(true);
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
      }),
    [
      ctx.effectiveFemMesh, ctx.hasSolverTelemetry, ctx.isFemBackend, ctx.material,
      ctx.mesherSourceKind, ctx.meshFeOrder, ctx.meshName,
      ctx.solverPlan?.integrator, ctx.solverPlan?.relaxation?.algorithm,
      ctx.solverSettings.integrator, ctx.solverSettings.relaxAlgorithm,
      ctx.effectiveDmDt, ctx.scalarRows.length,
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
  }, [ctx]);

  const handleNavigatorToggle = useCallback(() => {
    const panel = navigatorPanelRef.current;
    if (!panel) return;
    if (panel.isCollapsed()) {
      panel.expand();
      setNavigatorOpen(true);
      return;
    }
    panel.collapse();
    setNavigatorOpen(false);
  }, [navigatorPanelRef]);

  const handleInspectorToggle = useCallback(() => {
    const panel = inspectorPanelRef.current;
    if (!panel) return;
    if (panel.isCollapsed()) {
      panel.expand();
      setInspectorOpen(true);
      return;
    }
    panel.collapse();
    setInspectorOpen(false);
  }, [inspectorPanelRef]);

  const handleNavigatorResize = useCallback((panelSize: PanelSize) => {
    setNavigatorOpen(panelSize.inPixels > 68);
  }, []);

  const handleInspectorResize = useCallback((panelSize: PanelSize) => {
    setInspectorOpen(panelSize.inPixels > 68);
  }, []);

  return (
    <div className="flex w-full h-full border-l border-white/5 bg-gradient-to-br from-card/60 to-background/40 backdrop-blur-2xl shadow-[-8px_0_32px_rgba(0,0,0,0.4)] z-30">
      <PanelGroup
        orientation="vertical"
        className="flex w-full h-full flex-col"
        resizeTargetMinimumSize={{ coarse: 32, fine: 10 }}
      >
        <Panel
          id="sidebar-model-outline"
          defaultSize={34}
          minSize={15}
          collapsible
          collapsedSize={4}
          panelRef={navigatorPanelRef}
          onResize={handleNavigatorResize}
        >
          <section className="flex flex-col h-full bg-transparent">
            <button
              type="button"
              className="flex items-center w-full px-3 py-2.5 text-left transition-colors hover:bg-muted/50 border-b border-white/5 border-l-[3px] border-l-primary shadow-[0_4px_12px_rgba(0,0,0,0.1)] z-10 shrink-0 relative"
              onClick={handleNavigatorToggle}
              aria-expanded={navigatorOpen}
            >
              <span className={cn("text-primary/70 mr-2 font-black transition-transform duration-150 flex items-center justify-center w-4 h-4 text-[10px]", navigatorOpen && "rotate-90")}>▸</span>
              <span className="text-[0.65rem] font-bold uppercase tracking-[0.15em] text-foreground">Model</span>
              <span className="ml-auto text-[0.6rem] font-mono tracking-tight text-primary-foreground bg-primary/80 px-1.5 py-0.5 rounded-sm">{ctx.isFemBackend ? "FEM" : "FDM"}</span>
            </button>
            {navigatorOpen && (
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

        <PanelResizeHandle className="flex shrink-0 items-center justify-center bg-transparent h-1.5 cursor-row-resize relative z-10 hover:bg-primary/20 transition-colors after:absolute after:inset-x-0 after:top-1/2 after:-translate-y-1/2 after:h-px after:w-8 after:mx-auto after:bg-border/60 hover:after:bg-primary" />

        <Panel
          id="sidebar-inspector"
          defaultSize={66}
          minSize={20}
          collapsible
          collapsedSize={4}
          panelRef={inspectorPanelRef}
          onResize={handleInspectorResize}
        >
          <section className="flex flex-col h-full bg-transparent">
            <button
              type="button"
              className="flex items-center w-full px-3 py-2.5 text-left transition-colors hover:bg-muted/50 border-b border-white/5 border-l-[3px] border-l-emerald-500 shadow-[0_4px_12px_rgba(0,0,0,0.1)] z-10 shrink-0 relative"
              onClick={handleInspectorToggle}
              aria-expanded={inspectorOpen}
            >
              <span className={cn("text-emerald-500/70 mr-2 font-black transition-transform duration-150 flex items-center justify-center w-4 h-4 text-[10px]", inspectorOpen && "rotate-90")}>▸</span>
              <span className="text-[0.65rem] font-bold uppercase tracking-[0.15em] text-foreground">Inspector</span>
              <span className="ml-auto text-[0.6rem] font-mono tracking-tight text-muted-foreground bg-emerald-500/10 px-1.5 py-0.5 rounded-sm border border-emerald-500/20">{activeNode?.label ?? "Workspace"}</span>
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
