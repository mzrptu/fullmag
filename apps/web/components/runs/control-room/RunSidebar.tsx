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
import {
  findTreeNodeById,
  previewQuantityForTreeNode,
  resolveAntennaNodeName,
  resolveSelectedObjectId,
} from "./shared";
import { meshWorkspaceNodeToDockTab, meshWorkspaceNodeToPreset } from "./meshWorkspace";
import { DEFAULT_CONVERGENCE_THRESHOLD } from "../../panels/SolverSettingsPanel";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { TreeNodeData } from "../../panels/ModelTree";

type TreeFilterScope = "all" | "objects" | "mesh" | "physics" | "results";

function nodeMatchesScope(node: TreeNodeData, scope: TreeFilterScope): boolean {
  if (scope === "all") {
    return true;
  }
  const haystack = `${node.id} ${node.label} ${node.badge ?? ""}`.toLowerCase();
  switch (scope) {
    case "objects":
      return /^(objects|obj-|geo-|reg-|mat-|ant-)/.test(node.id) || haystack.includes("object");
    case "mesh":
      return (
        /mesh|airbox|universe-airbox|domain|boundary|interface/.test(haystack) ||
        node.id.startsWith("mesh") ||
        node.id.includes("-mesh")
      );
    case "physics":
      return /^(physics|phys-|study-solver|solver)/.test(node.id) || haystack.includes("physics");
    case "results":
      return /^(results|res-|analyze|preview)/.test(node.id) || haystack.includes("result");
  }
}

function filterTreeNodes(
  nodes: TreeNodeData[],
  query: string,
  scope: TreeFilterScope,
): TreeNodeData[] {
  const normalizedQuery = query.trim().toLowerCase();
  return nodes.flatMap((node) => {
    const filteredChildren = node.children
      ? filterTreeNodes(node.children, normalizedQuery, scope)
      : [];
    const scopeMatch = nodeMatchesScope(node, scope);
    const queryMatch =
      normalizedQuery.length === 0 ||
      node.label.toLowerCase().includes(normalizedQuery) ||
      node.id.toLowerCase().includes(normalizedQuery) ||
      node.badge?.toLowerCase().includes(normalizedQuery);
    if ((scopeMatch && queryMatch) || filteredChildren.length > 0) {
      return [{ ...node, children: filteredChildren.length > 0 ? filteredChildren : node.children }];
    }
    return [];
  });
}

function countTreeNodes(nodes: TreeNodeData[]): number {
  return nodes.reduce(
    (count, node) => count + 1 + (node.children ? countTreeNodes(node.children) : 0),
    0,
  );
}

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
  const [treeQuery, setTreeQuery] = useState("");
  const [treeFilterScope, setTreeFilterScope] = useState<TreeFilterScope>("all");
  const universeRole = useMemo(() => {
    if (!cmd.isFemBackend) {
      return "Grid / simulation domain";
    }
    switch (model.worldExtentSource) {
      case "declared_universe_manual":
        return "Declared universe / workspace framing";
      case "declared_universe_auto_padding":
        return "Auto-fit universe from bounds + padding";
      case "object_union_bounds":
        return "Object union bounds / preview framing";
      case "mesh_bounds":
        return "Mesh bounds fallback / preview framing";
      default:
        return "Workspace framing";
    }
  }, [cmd.isFemBackend, model.worldExtentSource]);
  const runtimeDeclaredUniverse = model.domainFrame?.declared_universe ?? null;

  /* ── Build model tree nodes ── */
  const modelTreeNodes = useMemo(
    () =>
      buildFullmagModelTree({
        graph: model.modelBuilderGraph,
        sceneDocument: model.sceneDocument,
        studyLabel: "Study",
        backend: cmd.isFemBackend ? "FEM" : "FDM",
        universeMode: runtimeDeclaredUniverse?.mode ?? null,
        universeDeclaredSize: runtimeDeclaredUniverse?.size ?? null,
        universeEffectiveSize: model.worldExtent,
        universeCenter: model.worldCenter,
        universePadding: runtimeDeclaredUniverse?.padding ?? null,
        universeRole,
        domainMeshMode: model.effectiveFemMesh?.domain_mesh_mode ?? null,
        airPartElementCount: model.airPart?.element_count ?? null,
        airPartNodeCount: model.airPart?.node_count ?? null,
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
          tp.hasSolverTelemetry && tp.effectiveDmDt > 0 && tp.effectiveDmDt < (Number(model.solverSettings.torqueTolerance) || DEFAULT_CONVERGENCE_THRESHOLD)
            ? "ready"
            : tp.hasSolverTelemetry
              ? "active"
              : undefined,
        scalarRowCount: tp.scalarRows.length,
      }),
    [
      model.modelBuilderGraph, model.sceneDocument, model.effectiveFemMesh, tp.hasSolverTelemetry, cmd.isFemBackend, model.material,
      model.mesherSourceKind, model.meshFeOrder, model.meshName,
      model.solverPlan?.integrator, model.solverPlan?.relaxation?.algorithm,
      model.solverSettings.integrator, model.solverSettings.relaxAlgorithm,
      tp.effectiveDmDt, tp.scalarRows.length, model.worldCenter, model.worldExtent, runtimeDeclaredUniverse?.mode, runtimeDeclaredUniverse?.padding, runtimeDeclaredUniverse?.size,
      universeRole,
    ],
  );

  /* ── Determine active node (from explicit selection or viewport context) ── */
  const fallbackNodeId = useMemo(() => {
    const isMeshView = cmd.isFemBackend && vp.effectiveViewMode === "Mesh";
    const sharedAirboxDomain =
      model.effectiveFemMesh?.domain_mesh_mode === "shared_domain_mesh_with_air";
    if (isMeshView) {
      if (sharedAirboxDomain) {
        if (model.femDockTab === "quality") return "mesh-quality";
        if (model.femDockTab === "pipeline") return "mesh-pipeline";
        if (model.femDockTab === "view") return "mesh-view";
        if (model.femDockTab === "mesher") return "universe-airbox-mesh";
        return "universe-airbox-mesh";
      }
      if (model.femDockTab === "quality") return "universe-mesh-quality";
      if (model.femDockTab === "pipeline") return "universe-mesh-pipeline";
      if (model.femDockTab === "view") return "universe-mesh-view";
      if (model.femDockTab === "mesher") return "universe-mesh-size";
      return "universe-mesh";
    }
    if (vp.previewControlsActive) return "res-fields";
    if (cmd.interactiveControlsEnabled) return "study-solver";
    const firstObjectId =
      model.sceneDocument?.objects[0]?.name ??
      model.sceneDocument?.objects[0]?.id ??
      model.modelBuilderGraph?.objects.items[0]?.id;
    if (firstObjectId) return `obj-${firstObjectId}`;
    return "objects";
  }, [vp.effectiveViewMode, model.effectiveFemMesh?.domain_mesh_mode, model.femDockTab, cmd.interactiveControlsEnabled,
      cmd.isFemBackend, model.modelBuilderGraph, model.sceneDocument, vp.previewControlsActive]);

  const activeNodeId = model.selectedSidebarNodeId ?? fallbackNodeId;
  const activeNode = useMemo(
    () => findTreeNodeById(modelTreeNodes, activeNodeId),
    [activeNodeId, modelTreeNodes],
  );
  const filteredModelTreeNodes = useMemo(
    () => filterTreeNodes(modelTreeNodes, treeQuery, treeFilterScope),
    [modelTreeNodes, treeFilterScope, treeQuery],
  );
  const filteredTreeNodeCount = useMemo(
    () => countTreeNodes(filteredModelTreeNodes),
    [filteredModelTreeNodes],
  );
  const activeAntennaName = useMemo(
    () =>
      resolveAntennaNodeName(
        activeNodeId,
        model.scriptBuilderCurrentModules.map((module) => module.name),
      ),
    [activeNodeId, model.scriptBuilderCurrentModules],
  );
  const activeNodeLabel =
    activeNode?.label ??
    (activeNodeId === "session"
      ? "Session"
      : activeNodeId === "script-builder"
        ? "Script Builder"
        :
    (activeNodeId === "antennas"
      ? "Antenna / RF Source"
      : activeAntennaName ?? "Workspace"));

  const selectModelNode = useCallback((id: string) => {
    const objectId = resolveSelectedObjectId(id, model.sceneDocument ?? model.modelBuilderGraph);
    model.setSelectedSidebarNodeId(id);
    model.setSelectedObjectId(objectId);
    if (id === "universe-airbox" || id === "universe-airbox-mesh") {
      const airPartId = model.airPart?.id ?? null;
      model.setSelectedEntityId(airPartId);
      model.setFocusedEntityId(airPartId);
      return;
    }
    if (objectId) {
      const partId =
        model.meshParts.find(
          (part) => part.role === "magnetic_object" && part.object_id === objectId,
        )?.id ?? null;
      model.setSelectedEntityId(partId);
      model.setFocusedEntityId(partId);
      return;
    }
    model.setSelectedEntityId(null);
    model.setFocusedEntityId(null);
  }, [model]);

  /* ── Tree click handler ── */
  const handleTreeClick = useCallback((id: string) => {
    selectModelNode(id);
    // Ensure inspector is visible when a node is clicked
    const panel = inspectorPanelRef.current;
    if (panel?.isCollapsed()) {
      panel.expand();
      setInspectorOpen(true);
    }
    const selectedObjectId = resolveSelectedObjectId(
      id,
      model.sceneDocument ?? model.modelBuilderGraph,
    );
    const isUniverseNode = id === "universe" || id.startsWith("universe-");
    const isGeometryScopedNode =
      id === "geometry" ||
      id === "objects" ||
      id.startsWith("obj-") ||
      id.startsWith("geo-") ||
      id.startsWith("reg-") ||
      id.startsWith("mat-") ||
      selectedObjectId != null;
    switch (id) {
      case "geometry":
      case "objects":
        if (cmd.isFemBackend && !model.effectiveFemMesh) model.openFemMeshWorkspace("mesh");
        else vp.setViewMode("3D");
        return;
      case "mesh":
      case "mesh-view":
      case "mesh-size":
      case "mesh-algorithm":
      case "mesh-quality":
      case "mesh-pipeline":
      case "universe-airbox-mesh":
      case "universe-mesh":
      case "universe-mesh-view":
      case "universe-mesh-size":
      case "universe-mesh-algorithm":
      case "universe-mesh-quality":
      case "universe-mesh-pipeline": {
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
      case "antennas":
        // Show the inspector with AntennaPanel
        return;
      default: {
        const isAntennaNode = id.startsWith("ant-");
        if (isAntennaNode) {
          // Try to preview antenna field when clicking on a specific antenna
          if (vp.quickPreviewTargets.some((t) => t.id === "H_ant" && t.available)) {
            vp.requestPreviewQuantity("H_ant");
          }
          vp.setViewMode("3D");
          return;
        }
        // Per-object mesh nodes (e.g. "geo-nanoflower-mesh") → open mesh workspace
        const isObjectMeshNode = id.startsWith("geo-") && id.endsWith("-mesh");
        if (isObjectMeshNode) {
          if (cmd.isFemBackend) {
            model.openFemMeshWorkspace("mesh");
          } else {
            vp.setViewMode("Mesh");
          }
          return;
        }
        if (isUniverseNode || isGeometryScopedNode) {
          if (cmd.isFemBackend && !model.effectiveFemMesh) model.openFemMeshWorkspace("mesh");
          else vp.setViewMode("3D");
          return;
        }
        const previewTarget = previewQuantityForTreeNode(id);
        if (previewTarget && vp.quickPreviewTargets.some((t) => t.id === previewTarget && t.available)) {
          vp.requestPreviewQuantity(previewTarget);
        }
      }
    }
  }, [cmd.isFemBackend, model, vp, inspectorPanelRef, selectModelNode]);

  const handleTreeContextAction = useCallback((nodeId: string, action: string) => {
    if (action === "focus") {
      const objectId = resolveSelectedObjectId(
        nodeId,
        model.sceneDocument ?? model.modelBuilderGraph,
      );
      if (!objectId) {
        return;
      }
      selectModelNode(nodeId);
      if (cmd.isFemBackend && !model.effectiveFemMesh) {
        model.requestFocusObject(objectId);
        model.openFemMeshWorkspace("mesh");
        return;
      }
      vp.setViewMode("3D");
      model.requestFocusObject(objectId);
      return;
    }
  }, [cmd.isFemBackend, model, selectModelNode, vp]);

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
    <div className="flex w-full h-full border-l border-border/10 bg-background/80 z-30">
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
          <section className="flex flex-col h-full bg-background/55 border-r border-border/10">
            <button
              type="button"
              className="flex items-center w-full px-3 py-2 text-left transition-all hover:bg-muted/20 border-b border-border/10 z-10 shrink-0 relative group"
              onClick={handleTreeToggle}
              aria-expanded={treeOpen}
            >
              <span className={cn("text-primary/60 mr-2 transition-transform duration-200 flex items-center justify-center w-4 h-4 text-[10px]", treeOpen && "rotate-90")}>▸</span>
              <span className="text-[0.72rem] font-semibold tracking-wide text-foreground/90 group-hover:text-foreground transition-colors">Model</span>
              <span className="ml-auto flex items-center gap-2">
                <span className="text-[0.58rem] font-mono font-bold tracking-tight text-primary-foreground bg-primary/80 px-1.5 py-0.5 rounded-sm shadow-sm">{cmd.isFemBackend ? "FEM" : "FDM"}</span>
              </span>
            </button>
            {treeOpen && (
              <div className="flex-1 min-h-0 min-w-0 pr-1 overflow-hidden isolate relative">
                <ScrollArea className="h-full w-full">
                  <div className="p-2 select-none space-y-2">
                    <div className="space-y-2 rounded-lg border border-border/15 bg-background/40 p-2">
                      <Input
                        value={treeQuery}
                        onChange={(event) => setTreeQuery(event.target.value)}
                        placeholder="Search tree…"
                        className="h-9 bg-background/60 text-[0.78rem]"
                        aria-label="Search model tree"
                      />
                      <div className="flex flex-wrap gap-1.5">
                        {(
                          [
                            ["all", "All"],
                            ["objects", "Objects"],
                            ["mesh", "Mesh"],
                            ["physics", "Physics"],
                            ["results", "Results"],
                          ] as const
                        ).map(([value, label]) => (
                          <button
                            key={value}
                            type="button"
                            className={cn(
                              "rounded-md border px-2.5 py-1 text-[0.68rem] font-medium transition-colors",
                              treeFilterScope === value
                                ? "border-primary/30 bg-primary/12 text-primary"
                                : "border-border/20 bg-background/30 text-muted-foreground hover:bg-muted/40 hover:text-foreground",
                            )}
                            onClick={() => setTreeFilterScope(value)}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      <div className="flex items-center justify-between text-[0.66rem] text-muted-foreground">
                        <span>
                          {filteredTreeNodeCount.toLocaleString()} visible node
                          {filteredTreeNodeCount === 1 ? "" : "s"}
                        </span>
                        {(treeQuery.length > 0 || treeFilterScope !== "all") && (
                          <button
                            type="button"
                            className="rounded px-1.5 py-0.5 text-[0.62rem] font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
                            onClick={() => {
                              setTreeQuery("");
                              setTreeFilterScope("all");
                            }}
                          >
                            Reset
                          </button>
                        )}
                      </div>
                    </div>
                    <ModelTree
                      nodes={filteredModelTreeNodes}
                      activeId={activeNodeId}
                      onNodeClick={handleTreeClick}
                      onContextAction={handleTreeContextAction}
                    />
                  </div>
                </ScrollArea>
              </div>
            )}
          </section>
        </Panel>

        {/* ── Resize handle (vertical divider) ── */}
        <PanelResizeHandle className="flex shrink-0 items-center justify-center bg-transparent w-1.5 cursor-col-resize relative z-10 hover:bg-primary/15 transition-colors after:absolute after:inset-y-0 after:left-1/2 after:-translate-x-1/2 after:w-px after:h-8 after:my-auto after:bg-border/40 hover:after:bg-primary/60" />

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
          <section className="flex flex-col h-full bg-background/35">
            <button
              type="button"
              className="flex items-center w-full px-3 py-2 text-left transition-all hover:bg-muted/20 border-b border-border/10 z-10 shrink-0 relative group"
              onClick={handleInspectorToggle}
              aria-expanded={inspectorOpen}
            >
              <span className={cn("text-primary/60 mr-2 transition-transform duration-200 flex items-center justify-center w-4 h-4 text-[10px]", inspectorOpen && "rotate-90")}>▸</span>
              <span className="text-[0.72rem] font-semibold tracking-wide text-foreground/90 group-hover:text-foreground transition-colors">
                Properties
              </span>
              <span className="ml-auto text-[0.62rem] font-medium tracking-tight text-muted-foreground bg-background/45 px-2 py-0.5 rounded-md border border-border/20 max-w-[140px] truncate">
                {activeNodeLabel}
              </span>
            </button>
            {inspectorOpen && (
              <div className="flex-1 min-h-0 min-w-0 overflow-hidden isolate relative">
                <ScrollArea className="h-full w-full">
                  <div className="p-1 select-none">
                    <SettingsPanel nodeId={activeNodeId} />
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
