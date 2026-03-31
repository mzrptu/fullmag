"use client";

import { useControlRoom } from "../../runs/control-room/ControlRoomContext";
import { fmtExp, fmtSI, type ViewportMode } from "../../runs/control-room/shared";
import type { RenderMode } from "../../preview/FemMeshView3D";
import { Button } from "../../ui/button";

export default function MeshPanel() {
  const ctx = useControlRoom();
  const {
    effectiveFemMesh, meshFeOrder, meshHmax, isMeshWorkspaceView,
    effectiveViewMode, handleViewModeChange, meshRenderMode, setMeshRenderMode,
    meshFaceDetail, meshSelection, setMeshSelection
  } = ctx;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1 p-2.5 bg-card/30 border border-border/30 rounded-lg">
          <span className="text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground">Backend</span>
          <span className="font-mono text-xs text-foreground">{ctx.mesherBackend ?? "—"}</span>
        </div>
        <div className="flex flex-col gap-1 p-2.5 bg-card/30 border border-border/30 rounded-lg">
          <span className="text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground">Source</span>
          <span className="font-mono text-xs text-foreground">{ctx.mesherSourceKind ?? ctx.meshSource ?? "—"}</span>
        </div>
      </div>

      <div className="grid gap-2.5 p-3 rounded-md bg-card/40 border border-border/40 shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground">Topology</span>
          <span className="text-[0.65rem] font-mono text-muted-foreground/70">
            {effectiveFemMesh?.elements.length ? "volume mesh" : "surface preview"}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="grid gap-1 px-2.5 py-2 rounded-lg bg-background/50 border border-border/30">
            <span className="text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground">Nodes</span>
            <span className="font-mono text-xs text-foreground">{effectiveFemMesh?.nodes.length.toLocaleString() ?? "0"}</span>
          </div>
          <div className="grid gap-1 px-2.5 py-2 rounded-lg bg-background/50 border border-border/30">
            <span className="text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground">Elements</span>
            <span className="font-mono text-xs text-foreground">{effectiveFemMesh?.elements.length.toLocaleString() ?? "0"}</span>
          </div>
          <div className="grid gap-1 px-2.5 py-2 rounded-lg bg-background/50 border border-border/30">
            <span className="text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground">Faces</span>
            <span className="font-mono text-xs text-foreground">{effectiveFemMesh?.boundary_faces.length.toLocaleString() ?? "0"}</span>
          </div>
          <div className="grid gap-1 px-2.5 py-2 rounded-lg bg-background/50 border border-border/30">
            <span className="text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground">FE order</span>
            <span className="font-mono text-xs text-foreground">{meshFeOrder != null ? String(meshFeOrder) : "—"}</span>
          </div>
          <div className="grid gap-1 px-2.5 py-2 rounded-lg bg-background/50 border border-border/30">
            <span className="text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground">hmax</span>
            <span className="font-mono text-xs text-foreground">{meshHmax != null ? fmtSI(meshHmax, "m") : "—"}</span>
          </div>
        </div>
      </div>

      <div className="grid gap-2.5 p-3 rounded-md bg-card/40 border border-border/40 shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground">Inspect</span>
        </div>
        <div className="flex flex-wrap gap-1">
          {(["Mesh", "3D", "2D"] as ViewportMode[]).map((mode) => (
            <button
              key={mode}
              className="appearance-none border border-border/40 bg-background/50 text-muted-foreground text-[0.65rem] font-bold uppercase tracking-widest rounded-md py-1.5 px-2 cursor-pointer transition-colors hover:bg-muted/50 data-[active=true]:bg-primary/20 data-[active=true]:border-primary/50 data-[active=true]:text-primary disabled:opacity-50 disabled:cursor-not-allowed"
              data-active={effectiveViewMode === mode}
              onClick={() => handleViewModeChange(mode)}
              type="button"
            >
              {mode}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1">
          {([
            ["surface", "Surface"],
            ["surface+edges", "Surface+Edges"],
            ["wireframe", "Wireframe"],
            ["points", "Points"],
          ] as [RenderMode, string][]).map(([mode, label]) => (
            <button
              key={mode}
              className="appearance-none border border-border/40 bg-background/50 text-muted-foreground text-[0.65rem] font-bold uppercase tracking-widest rounded-md py-1.5 px-2 cursor-pointer transition-colors hover:bg-muted/50 data-[active=true]:bg-primary/20 data-[active=true]:border-primary/50 data-[active=true]:text-primary disabled:opacity-50 disabled:cursor-not-allowed"
              data-active={meshRenderMode === mode}
              onClick={() => setMeshRenderMode(mode)}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {meshFaceDetail && (
        <div className="grid gap-2.5 p-3 rounded-md bg-card/40 border border-border/40 shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground">Selection</span>
            <span className="text-[0.65rem] font-mono text-muted-foreground/70">
              {meshSelection.selectedFaceIndices.length} face{meshSelection.selectedFaceIndices.length === 1 ? "" : "s"}
            </span>
          </div>
          <div className="grid gap-1.5 text-xs text-foreground bg-background/50 p-2 rounded border border-border/30">
            <div className="grid grid-cols-[92px_1fr] gap-2"><span className="text-[0.65rem] font-bold uppercase text-muted-foreground">Face</span><span className="font-mono">#{meshFaceDetail.faceIndex}</span></div>
            <div className="grid grid-cols-[92px_1fr] gap-2"><span className="text-[0.65rem] font-bold uppercase text-muted-foreground">Nodes</span><span className="font-mono truncate" title={meshFaceDetail.nodeIndices.join(", ")}>{meshFaceDetail.nodeIndices.join(", ")}</span></div>
            <div className="grid grid-cols-[92px_1fr] gap-2"><span className="text-[0.65rem] font-bold uppercase text-muted-foreground">Area</span><span className="font-mono">{fmtExp(meshFaceDetail.area)} m²</span></div>
            <div className="grid grid-cols-[92px_1fr] gap-2"><span className="text-[0.65rem] font-bold uppercase text-muted-foreground">Perimeter</span><span className="font-mono">{fmtSI(meshFaceDetail.perimeter, "m")}</span></div>
            <div className="grid grid-cols-[92px_1fr] gap-2"><span className="text-[0.65rem] font-bold uppercase text-muted-foreground">Aspect Ratio</span><span className="font-mono">{meshFaceDetail.aspectRatio.toFixed(2)}</span></div>
            <div className="grid grid-cols-[92px_1fr] gap-2"><span className="text-[0.65rem] font-bold uppercase text-muted-foreground">Centroid</span><span className="font-mono truncate" title={meshFaceDetail.centroid.map((v) => fmtExp(v)).join(", ")}>{meshFaceDetail.centroid.map((v) => fmtExp(v)).join(", ")}</span></div>
          </div>
          <Button size="sm" variant="outline" onClick={() => setMeshSelection({ selectedFaceIndices: [], primaryFaceIndex: null })}>
            Clear selection
          </Button>
        </div>
      )}
    </div>
  );
}
