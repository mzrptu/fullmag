"use client";

import { useEffect, useMemo, useState } from "react";
import FemMeshView3D, { type FemMeshData } from "@/components/preview/FemMeshView3D";
import { currentLiveApiClient } from "@/lib/liveApiClient";
import { normalizeSessionState } from "@/lib/session/normalize";
import type { FemLiveMesh } from "@/lib/session/types";
import { FRONTEND_DIAGNOSTIC_FLAGS } from "@/lib/debug/frontendDiagnosticFlags";
import { recordFrontendRender } from "@/lib/debug/frontendPerfDebug";

function flattenFemMesh(mesh: FemLiveMesh): FemMeshData {
  const flatNodes = new Float64Array(mesh.nodes.length * 3);
  for (let i = 0; i < mesh.nodes.length; i += 1) {
    const node = mesh.nodes[i];
    flatNodes[i * 3] = node[0];
    flatNodes[i * 3 + 1] = node[1];
    flatNodes[i * 3 + 2] = node[2];
  }

  const flatElements = new Uint32Array(mesh.elements.length * 4);
  for (let i = 0; i < mesh.elements.length; i += 1) {
    const element = mesh.elements[i];
    flatElements[i * 4] = element[0];
    flatElements[i * 4 + 1] = element[1];
    flatElements[i * 4 + 2] = element[2];
    flatElements[i * 4 + 3] = element[3];
  }

  const flatFaces = new Uint32Array(mesh.boundary_faces.length * 3);
  for (let i = 0; i < mesh.boundary_faces.length; i += 1) {
    const face = mesh.boundary_faces[i];
    flatFaces[i * 3] = face[0];
    flatFaces[i * 3 + 1] = face[1];
    flatFaces[i * 3 + 2] = face[2];
  }

  return {
    nodes: Array.from(flatNodes),
    elements: Array.from(flatElements),
    boundaryFaces: Array.from(flatFaces),
    nNodes: mesh.nodes.length,
    nElements: mesh.elements.length,
    fieldData: undefined,
    activeMask: null,
    quantityDomain: "full_domain",
  };
}

export default function StandaloneFemDiagnosticViewport() {
  if (FRONTEND_DIAGNOSTIC_FLAGS.renderDebug.enableRenderLogging) {
    recordFrontendRender("StandaloneFemDiagnosticViewport");
  }

  const [mesh, setMesh] = useState<FemLiveMesh | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [fps, setFps] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    void currentLiveApiClient()
      .fetchBootstrap()
      .then((raw) => {
        if (cancelled) return;
        const state = normalizeSessionState(raw);
        const nextMesh = state.fem_mesh ?? state.live_state?.fem_mesh ?? null;
        if (!nextMesh || nextMesh.nodes.length === 0 || nextMesh.elements.length === 0) {
          setError("Bootstrap loaded, but no FEM mesh was available.");
          setMesh(null);
          return;
        }
        setMesh(nextMesh);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setMesh(null);
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let frameId = 0;
    let disposed = false;
    let frames = 0;
    const sampleRef = { time: performance.now() };

    const tick = () => {
      if (disposed) {
        return;
      }
      frameId = window.requestAnimationFrame(tick);
      frames += 1;
      const now = performance.now();
      const elapsed = now - sampleRef.time;
      if (elapsed >= 500) {
        setFps(Math.round((frames * 1000) / elapsed));
        frames = 0;
        sampleRef.time = now;
      }
    };

    frameId = window.requestAnimationFrame(tick);
    return () => {
      disposed = true;
      window.cancelAnimationFrame(frameId);
    };
  }, []);

  const meshData = useMemo(() => (mesh ? flattenFemMesh(mesh) : null), [mesh]);

  return (
    <div className="relative h-full w-full min-h-0 min-w-0 overflow-hidden bg-background">
      {meshData ? (
        <FemMeshView3D
          meshData={meshData}
          toolbarMode="hidden"
          renderMode="surface"
          objectSegments={mesh?.object_segments ?? []}
          meshParts={mesh?.mesh_parts ?? []}
          elementMarkers={mesh?.element_markers ?? null}
          perDomainQuality={mesh?.per_domain_quality ?? null}
        />
      ) : (
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          {loading ? "Loading FEM bootstrap mesh..." : error ?? "No FEM mesh available"}
        </div>
      )}

      <div className="pointer-events-none absolute left-3 top-3 rounded-md border border-white/10 bg-black/35 px-3 py-2 text-xs text-white/80">
        <div>Standalone FEM diagnostic viewport</div>
        <div>{loading ? "Status: loading" : meshData ? "Status: loaded" : `Status: ${error ?? "empty"}`}</div>
        <div>{fps == null ? "FPS: measuring..." : `FPS: ${fps}`}</div>
        {mesh ? <div>{`${mesh.nodes.length.toLocaleString()} nodes, ${mesh.elements.length.toLocaleString()} tets`}</div> : null}
      </div>
    </div>
  );
}
