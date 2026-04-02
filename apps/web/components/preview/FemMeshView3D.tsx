"use client";

import { useEffect, useRef, useState, useMemo, useCallback, memo } from "react";
import * as THREE from "three";
import { Canvas, useThree } from "@react-three/fiber";
import { TrackballControls, PivotControls } from "@react-three/drei";
import HslSphere from "./HslSphere";
import ViewCube from "./ViewCube";
import { cn } from "@/lib/utils";
import { FemGeometry } from "./r3f/FemGeometry";
import { FemArrows } from "./r3f/FemArrows";
import { FemHighlightView } from "./r3f/FemHighlightView";
import { rotateCameraAroundTarget, setCameraPresetAroundTarget, focusCameraOnBounds, fitCameraToBounds } from "./camera/cameraHelpers";
import SceneAxes3D from "./r3f/SceneAxes3D";
import { computeFaceAspectRatios } from "./r3f/colorUtils";
import type { FemLiveMeshObjectSegment } from "../../lib/session/types";
import type {
  AntennaOverlay,
  BuilderObjectOverlay,
  FocusObjectRequest,
  ViewportScope,
} from "../runs/control-room/shared";
import { viewportScopeObjectId } from "../runs/control-room/shared";

/* ── Types ─────────────────────────────────────────────────────────── */

export interface FemMeshData {
  nodes: number[];
  elements: number[];
  boundaryFaces: number[];
  nNodes: number;
  nElements: number;
  fieldData?: { x: number[]; y: number[]; z: number[]; };
}

export interface MeshSelectionSnapshot {
  selectedFaceIndices: number[];
  primaryFaceIndex: number | null;
}

export type FemColorField = "orientation" | "x" | "y" | "z" | "magnitude" | "quality" | "sicn" | "none";
export type RenderMode = "surface" | "surface+edges" | "wireframe" | "points";
export type ClipAxis = "x" | "y" | "z";

interface Props {
  meshData: FemMeshData;
  colorField?: FemColorField;
  fieldLabel?: string;
  showWireframe?: boolean;
  topologyKey?: string;
  toolbarMode?: "visible" | "hidden";
  renderMode?: RenderMode;
  opacity?: number;
  clipEnabled?: boolean;
  clipAxis?: ClipAxis;
  clipPos?: number;
  showArrows?: boolean;
  showOrientationLegend?: boolean;
  qualityPerFace?: number[] | null;
  shrinkFactor?: number;
  onRenderModeChange?: (value: RenderMode) => void;
  onOpacityChange?: (value: number) => void;
  onClipEnabledChange?: (value: boolean) => void;
  onClipAxisChange?: (value: ClipAxis) => void;
  onClipPosChange?: (value: number) => void;
  onShowArrowsChange?: (value: boolean) => void;
  onShrinkFactorChange?: (value: number) => void;
  onSelectionChange?: (selection: MeshSelectionSnapshot) => void;
  onRefine?: (faceIndices: number[], factor: number) => void;
  antennaOverlays?: AntennaOverlay[];
  selectedAntennaId?: string | null;
  objectOverlays?: BuilderObjectOverlay[];
  selectedObjectId?: string | null;
  selectedMeshObjectId?: string | null;
  objectSegments?: FemLiveMeshObjectSegment[];
  focusObjectRequest?: FocusObjectRequest | null;
  viewportScope?: ViewportScope;
  worldExtent?: [number, number, number] | null;
  worldCenter?: [number, number, number] | null;
  onAntennaTranslate?: (id: string, dx: number, dy: number, dz: number) => void;
}

function collectSegmentBoundaryFaceIndices(
  objectSegments: readonly FemLiveMeshObjectSegment[],
  maxFaceCount: number,
  selectedObjectId?: string | null,
): number[] | null {
  const relevantSegments =
    selectedObjectId
      ? objectSegments.filter((segment) => segment.object_id === selectedObjectId)
      : objectSegments;
  if (relevantSegments.length === 0) {
    return null;
  }
  const faceIndices: number[] = [];
  for (const segment of relevantSegments) {
    const start = Math.max(0, Math.trunc(segment.boundary_face_start));
    const count = Math.max(0, Math.trunc(segment.boundary_face_count));
    const end = Math.min(start + count, maxFaceCount);
    for (let faceIndex = start; faceIndex < end; faceIndex += 1) {
      faceIndices.push(faceIndex);
    }
  }
  if (faceIndices.length === 0 || faceIndices.length >= maxFaceCount) {
    return null;
  }
  return faceIndices;
}

function collectSegmentElementIndices(
  objectSegments: readonly FemLiveMeshObjectSegment[],
  maxElementCount: number,
  selectedObjectId?: string | null,
): number[] | null {
  const relevantSegments =
    selectedObjectId
      ? objectSegments.filter((segment) => segment.object_id === selectedObjectId)
      : objectSegments;
  if (relevantSegments.length === 0) {
    return null;
  }
  const elementIndices: number[] = [];
  for (const segment of relevantSegments) {
    const start = Math.max(0, Math.trunc(segment.element_start));
    const count = Math.max(0, Math.trunc(segment.element_count));
    const end = Math.min(start + count, maxElementCount);
    for (let elementIndex = start; elementIndex < end; elementIndex += 1) {
      elementIndices.push(elementIndex);
    }
  }
  if (elementIndices.length === 0 || elementIndices.length >= maxElementCount) {
    return null;
  }
  return elementIndices;
}

function expandedOverlayBounds(
  overlay: BuilderObjectOverlay,
): { min: [number, number, number]; max: [number, number, number] } | null {
  const extent = [
    overlay.boundsMax[0] - overlay.boundsMin[0],
    overlay.boundsMax[1] - overlay.boundsMin[1],
    overlay.boundsMax[2] - overlay.boundsMin[2],
  ] as const;
  if (extent.some((value) => !Number.isFinite(value) || value <= 0)) {
    return null;
  }
  const tolerance = Math.max(Math.max(...extent) * 0.02, 1e-12);
  return {
    min: [
      overlay.boundsMin[0] - tolerance,
      overlay.boundsMin[1] - tolerance,
      overlay.boundsMin[2] - tolerance,
    ],
    max: [
      overlay.boundsMax[0] + tolerance,
      overlay.boundsMax[1] + tolerance,
      overlay.boundsMax[2] + tolerance,
    ],
  };
}

const RENDER_OPTIONS: { value: RenderMode; label: string }[] = [
  { value: "surface", label: "Surface" },
  { value: "surface+edges", label: "S+E" },
  { value: "wireframe", label: "Wire" },
  { value: "points", label: "Pts" },
];

const COLOR_OPTIONS: { value: FemColorField; label: string }[] = [
  { value: "orientation", label: "Ori" },
  { value: "z", label: "Fz" },
  { value: "x", label: "Fx" },
  { value: "y", label: "Fy" },
  { value: "magnitude", label: "|F|" },
  { value: "quality", label: "AR" },
  { value: "sicn", label: "SICN" },
  { value: "none", label: "—" },
];

/* ── Global R3F Logic Components ───────────────────────────────────── */

function FemClipPlanes({ enabled, axis, posPercentage, geomSize }: { enabled: boolean; axis: ClipAxis; posPercentage: number; geomSize: [number, number, number] }) {
  const { gl } = useThree();
  useEffect(() => {
    gl.localClippingEnabled = enabled;
    if (!enabled) {
      gl.clippingPlanes = [];
      return;
    }
    const axisSize = axis === "x" ? geomSize[0] : axis === "y" ? geomSize[1] : geomSize[2];
    const pos = ((posPercentage / 100) - 0.5) * axisSize;
    const normal = new THREE.Vector3(axis === "x" ? -1 : 0, axis === "y" ? -1 : 0, axis === "z" ? -1 : 0);
    gl.clippingPlanes = [new THREE.Plane(normal, pos)];
  }, [gl, enabled, axis, posPercentage, geomSize]);
  return null;
}

/** Auto-fit the R3F camera to the geometry bounding sphere whenever maxDim changes. */
function CameraAutoFit({ maxDim, generation }: { maxDim: number; generation: number }) {
  const { camera, invalidate } = useThree();
  useEffect(() => {
    if (maxDim <= 0 || generation === 0) return;
    fitCameraToBounds(camera, maxDim);
    invalidate();
  }, [camera, invalidate, maxDim, generation]);
  return null;
}

function SyncedControls({ 
  controlsRefObject, viewCubeBridgeRef
}: { 
  controlsRefObject: any, viewCubeBridgeRef: any
}) {
  const { camera } = useThree();
  useEffect(() => {
    viewCubeBridgeRef.current = { camera, controls: controlsRefObject.current };
  }, [camera, controlsRefObject, viewCubeBridgeRef]);
  return <TrackballControls ref={controlsRefObject} rotateSpeed={3} zoomSpeed={1.2} panSpeed={0.8} target={[0, 0, 0]} />;
}

function antennaOverlayColors(role: AntennaOverlay["conductors"][number]["role"], selected: boolean) {
  if (role === "ground") {
    return selected
      ? { fill: "#67e8f9", wire: "#a5f3fc" }
      : { fill: "#0ea5e9", wire: "#67e8f9" };
  }
  return selected
    ? { fill: "#fb923c", wire: "#fdba74" }
    : { fill: "#f97316", wire: "#fb923c" };
}

function AntennaOverlayMeshes({
  overlays,
  geomCenter,
  selectedAntennaId,
  onAntennaTranslate,
}: {
  overlays: AntennaOverlay[];
  geomCenter: THREE.Vector3;
  selectedAntennaId?: string | null;
  onAntennaTranslate?: (id: string, dx: number, dy: number, dz: number) => void;
}) {
  const groupRef = useRef<THREE.Group>(null);
  
  return (
    <group>
      {overlays.map((overlay) => {
        const selected = selectedAntennaId === overlay.id;
        const conductors = overlay.conductors.map((conductor) => {
          const size = [
            conductor.boundsMax[0] - conductor.boundsMin[0],
            conductor.boundsMax[1] - conductor.boundsMin[1],
            conductor.boundsMax[2] - conductor.boundsMin[2],
          ] as const;
          if (size.some((value) => value <= 0)) {
            return null;
          }
          const center = [
            0.5 * (conductor.boundsMin[0] + conductor.boundsMax[0]) - geomCenter.x,
            0.5 * (conductor.boundsMin[1] + conductor.boundsMax[1]) - geomCenter.y,
            0.5 * (conductor.boundsMin[2] + conductor.boundsMax[2]) - geomCenter.z,
          ] as const;
          const colors = antennaOverlayColors(conductor.role, selected);
          return (
            <group key={conductor.id}>
              <mesh position={center} renderOrder={8}>
                <boxGeometry args={size} />
                <meshStandardMaterial
                  color={colors.fill}
                  emissive={colors.fill}
                  emissiveIntensity={selected ? 0.35 : 0.18}
                  transparent
                  opacity={selected ? 0.34 : 0.16}
                  depthWrite={false}
                />
              </mesh>
              <mesh position={center} renderOrder={9}>
                <boxGeometry args={size} />
                <meshBasicMaterial
                  color={colors.wire}
                  wireframe
                  transparent
                  opacity={selected ? 0.95 : 0.72}
                  depthWrite={false}
                />
              </mesh>
            </group>
          );
        });

        if (selected && onAntennaTranslate) {
          return (
            <PivotControls
              key={overlay.id}
              depthTest={false}
              lineWidth={2}
              axisColors={["#f87171", "#4ade80", "#60a5fa"]}
              scale={75}
              fixed={true}
              onDragEnd={() => {
                if (groupRef.current) {
                  const p = groupRef.current.position;
                  onAntennaTranslate(overlay.id, p.x, p.y, p.z);
                  groupRef.current.position.set(0, 0, 0);
                }
              }}
            >
              <group ref={groupRef}>{conductors}</group>
            </PivotControls>
          );
        }
        return <group key={overlay.id}>{conductors}</group>;
      })}
    </group>
  );
}

/* ── Component ─────────────────────────────────────────────────────── */

function FemMeshView3DInner({
  meshData,
  colorField = "z",
  toolbarMode = "visible",
  renderMode: controlledRenderMode,
  opacity: controlledOpacity,
  clipEnabled: controlledClipEnabled,
  clipAxis: controlledClipAxis,
  clipPos: controlledClipPos,
  showArrows: controlledShowArrows,
  showOrientationLegend = false,
  qualityPerFace,
  topologyKey,
  shrinkFactor: controlledShrinkFactor,
  onRenderModeChange,
  onOpacityChange,
  onClipEnabledChange,
  onClipAxisChange,
  onClipPosChange,
  onShowArrowsChange,
  onShrinkFactorChange,
  onSelectionChange,
  onRefine,
  antennaOverlays = [],
  selectedAntennaId,
  objectOverlays = [],
  selectedObjectId,
  selectedMeshObjectId = null,
  objectSegments = [],
  focusObjectRequest = null,
  viewportScope = "universe",
  worldExtent = null,
  worldCenter = null,
  onAntennaTranslate,
}: Props) {
  const [internalRenderMode, setInternalRenderMode] = useState<RenderMode>("surface");
  const [field, setField] = useState<FemColorField>(colorField);
  const [internalOpacity, setInternalOpacity] = useState(100);
  const [internalClipEnabled, setInternalClipEnabled] = useState(false);
  const [internalClipAxis, setInternalClipAxis] = useState<ClipAxis>("x");
  const [internalClipPos, setInternalClipPos] = useState(50);
  const [showClipDrop, setShowClipDrop] = useState(false);
  const [internalShowArrows, setInternalShowArrows] = useState(false);
  const [arrowDensity, setArrowDensity] = useState(1200);
  const [internalShrinkFactor, setInternalShrinkFactor] = useState(1);
  
  const [hoveredFace, setHoveredFace] = useState<{ idx: number; x: number; y: number } | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; faceIdx: number } | null>(null);
  const [selectedFaces, setSelectedFaces] = useState<number[]>([]);
  
  const [geomCenter, setGeomCenter] = useState<THREE.Vector3>(new THREE.Vector3());
  const [maxDim, setMaxDim] = useState<number>(0);
  const [geomSize, setGeomSize] = useState<[number, number, number]>([1, 1, 1]);
  const [cameraFitGeneration, setCameraFitGeneration] = useState(0);

  const controlsRef = useRef<any>(null);
  const viewCubeSceneRef = useRef<any>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const faceARsRef = useRef<Float32Array | null>(null);
  const renderMode = controlledRenderMode ?? internalRenderMode;
  const opacity = controlledOpacity ?? internalOpacity;
  const clipEnabled = controlledClipEnabled ?? internalClipEnabled;
  const clipAxis = controlledClipAxis ?? internalClipAxis;
  const clipPos = controlledClipPos ?? internalClipPos;
  const showArrows = controlledShowArrows ?? internalShowArrows;
  const shrinkFactor = controlledShrinkFactor ?? internalShrinkFactor;
  const scopeObjectId =
    viewportScopeObjectId(viewportScope) ?? selectedMeshObjectId ?? selectedObjectId ?? null;
  const missingExactScopeSegment =
    Boolean(scopeObjectId) &&
    !objectSegments.some((segment) => segment.object_id === scopeObjectId);
  const displayBoundaryFaceIndices = useMemo(() => {
    if (missingExactScopeSegment) {
      return null;
    }
    return collectSegmentBoundaryFaceIndices(
      objectSegments,
      Math.floor(meshData.boundaryFaces.length / 3),
      scopeObjectId,
    );
  }, [
    meshData.boundaryFaces.length,
    missingExactScopeSegment,
    objectSegments,
    scopeObjectId,
  ]);
  const displayElementIndices = useMemo(() => {
    if (missingExactScopeSegment) {
      return null;
    }
    return collectSegmentElementIndices(
      objectSegments,
      meshData.nElements,
      scopeObjectId,
    );
  }, [
    meshData.nElements,
    missingExactScopeSegment,
    objectSegments,
    scopeObjectId,
  ]);
  
  const topologySignature = topologyKey ?? `${meshData.nNodes}:${meshData.nElements}:${meshData.boundaryFaces.length}`;
  const effectiveOpacity = opacity;
  const effectiveShowArrows = showArrows;

  useEffect(() => { setField(colorField); }, [colorField]);
  useEffect(() => {
    setSelectedFaces([]); setHoveredFace(null); setCtxMenu(null);
    faceARsRef.current = null;
    // Note: Camera auto-fit is now handled in handleGeometryCenter based on physical bounds, 
    // not purely on node counts, to prevent camera resets during remeshing operations.
  }, [topologySignature]);

  useEffect(() => {
    onSelectionChange?.({
      selectedFaceIndices: selectedFaces,
      primaryFaceIndex: selectedFaces.length > 0 ? selectedFaces[selectedFaces.length - 1] : null,
    });
  }, [onSelectionChange, selectedFaces]);

  // Click & Raycast handlers
  const handleFaceHover = useCallback((e: any) => {
    if (e.faceIndex != null) setHoveredFace({ idx: e.faceIndex, x: e.clientX, y: e.clientY });
  }, []);
  const handleFaceUnhover = useCallback(() => setHoveredFace(null), []);
  const handleFaceClick = useCallback((e: any) => {
    if (e.button !== 0 || e.faceIndex == null) return;
    e.stopPropagation();
    const fIdx = e.faceIndex;
    setSelectedFaces((prev) => {
      if (e.shiftKey || e.ctrlKey) return prev.includes(fIdx) ? prev.filter((i) => i !== fIdx) : [...prev, fIdx];
      if (prev.length === 1 && prev[0] === fIdx) return [];
      return [fIdx];
    });
  }, []);
  const handleFaceContextMenu = useCallback((e: any) => {
    e.stopPropagation();
    e.preventDefault();
    if (e.faceIndex != null) setCtxMenu({ x: e.clientX, y: e.clientY, faceIdx: e.faceIndex });
  }, []);
  const dismissCtxMenu = useCallback(() => setCtxMenu(null), []);

  useEffect(() => {
    if (!ctxMenu) return;
    const dismiss = () => setCtxMenu(null);
    window.addEventListener("click", dismiss, { once: true });
    return () => window.removeEventListener("click", dismiss);
  }, [ctxMenu]);

  const lastFittedGeomRef = useRef<string | null>(null);
  const axesWorldExtent = useMemo<[number, number, number]>(() => {
    if (scopeObjectId) {
      return geomSize;
    }
    if (
      worldExtent &&
      worldExtent.every((component) => Number.isFinite(component) && component > 0)
    ) {
      return worldExtent;
    }
    return geomSize;
  }, [geomSize, worldExtent]);
  const axesCenter = useMemo<[number, number, number]>(() => {
    if (scopeObjectId) {
      return [0, 0, 0];
    }
    if (
      worldCenter &&
      worldCenter.every((component) => Number.isFinite(component))
    ) {
      return [
        worldCenter[0] - geomCenter.x,
        worldCenter[1] - geomCenter.y,
        worldCenter[2] - geomCenter.z,
      ];
    }
    return [0, 0, 0];
  }, [geomCenter.x, geomCenter.y, geomCenter.z, worldCenter]);
  const sceneMaxDim = useMemo(
    () => Math.max(maxDim, axesWorldExtent[0], axesWorldExtent[1], axesWorldExtent[2]),
    [axesWorldExtent, maxDim],
  );

  const handleGeometryCenter = useCallback((c: THREE.Vector3, m: number, s: THREE.Vector3) => {
    setGeomCenter(c); setMaxDim(m); setGeomSize([s.x, s.y, s.z]);
    
    // Create a stable signature based on the bounding box dimensions and center, rounded to 4 decimals.
    // This ensures that remeshing the EXACT SAME physical geometry does not reset the camera.
    const sig = `${m.toFixed(4)}_${c.x.toFixed(4)}_${c.y.toFixed(4)}_${c.z.toFixed(4)}`;
    if (lastFittedGeomRef.current !== sig) {
      lastFittedGeomRef.current = sig;
      setCameraFitGeneration((g) => g + 1);
    }
  }, []);

  const setCameraPreset = useCallback((view: "reset" | "front" | "top" | "right") => {
    const bridge = viewCubeSceneRef.current;
    if (!bridge?.camera || !bridge?.controls) return;
    setCameraPresetAroundTarget(bridge.camera, bridge.controls, view, sceneMaxDim * 2);
  }, [sceneMaxDim]);

  const focusObject = useCallback((objectId: string) => {
    const overlay = objectOverlays.find((candidate) => candidate.id === objectId);
    const bridge = viewCubeSceneRef.current;
    if (!overlay || !bridge?.camera || !bridge?.controls) return;
    focusCameraOnBounds(bridge.camera, bridge.controls, {
      min: [
        overlay.boundsMin[0] - geomCenter.x,
        overlay.boundsMin[1] - geomCenter.y,
        overlay.boundsMin[2] - geomCenter.z,
      ],
      max: [
        overlay.boundsMax[0] - geomCenter.x,
        overlay.boundsMax[1] - geomCenter.y,
        overlay.boundsMax[2] - geomCenter.z,
      ],
    }, { fallbackMinRadius: sceneMaxDim * 0.05 });
  }, [geomCenter, objectOverlays, sceneMaxDim]);

  useEffect(() => {
    if (!focusObjectRequest) {
      return;
    }
    focusObject(focusObjectRequest.objectId);
  }, [focusObject, focusObjectRequest]);

  const handleViewCubeRotate = useCallback((quat: THREE.Quaternion) => {
    const bridge = viewCubeSceneRef.current;
    if (!bridge?.camera || !bridge?.controls) return;
    rotateCameraAroundTarget(bridge.camera, bridge.controls, quat);
  }, []);

  const takeScreenshot = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = `fem-mesh-${Date.now()}.png`;
    a.click();
  }, []);

  // Pre-compute face aspect ratios when topology changes (fix #7: no first-hover jank)
  useEffect(() => {
    faceARsRef.current = computeFaceAspectRatios(meshData.nodes, meshData.boundaryFaces);
  }, [topologySignature, meshData.nodes, meshData.boundaryFaces]);

  const hoveredFaceInfo = useMemo(() => {
    if (!hoveredFace) return null;
    const idx = hoveredFace.idx;
    const ar = faceARsRef.current ? faceARsRef.current[idx] : 0;
    return { faceIdx: idx, ar, sicn: qualityPerFace?.[idx] };
  }, [hoveredFace, qualityPerFace]);
  return (
    <div className="relative flex flex-1 w-[100%] h-[100%] min-w-0 min-h-0 bg-background overflow-hidden rounded-md fem-canvas-container">
      <Canvas
        camera={{ position: [3, 2.4, 3], fov: 45, near: 0.0001, far: 10000 }}
        gl={{ antialias: true, preserveDrawingBuffer: true, localClippingEnabled: true }}
        onPointerMissed={() => setSelectedFaces([])}
        onContextMenu={(e) => e.preventDefault()}
        onCreated={({ gl }) => { canvasRef.current = gl.domElement; }}
      >
        <color attach="background" args={[0x1e1e2e]} /> {/* Catppuccin Mocha Base */}
        <ambientLight intensity={0.4} />
        <directionalLight position={[1, 2, 3]} intensity={0.9} />
        <directionalLight position={[-1, -1, -2]} intensity={0.3} color={0x6688cc} />
        
        <CameraAutoFit maxDim={sceneMaxDim} generation={cameraFitGeneration} />

        <FemClipPlanes enabled={clipEnabled} axis={clipAxis} posPercentage={clipPos} geomSize={geomSize} />
        
        {!missingExactScopeSegment ? (
          <>
            <FemGeometry
              meshData={meshData} field={field} renderMode={renderMode} opacity={effectiveOpacity} displayBoundaryFaceIndices={displayBoundaryFaceIndices} displayElementIndices={displayElementIndices} qualityPerFace={qualityPerFace}
              shrinkFactor={shrinkFactor} clipEnabled={clipEnabled} clipAxis={clipAxis} clipPos={clipPos}
              onGeometryCenter={handleGeometryCenter}
              onFaceClick={handleFaceClick} onFaceHover={handleFaceHover} onFaceUnhover={handleFaceUnhover} onFaceContextMenu={handleFaceContextMenu}
            />
            <FemArrows meshData={meshData} field={field} arrowDensity={arrowDensity} center={geomCenter} maxDim={maxDim} visible={effectiveShowArrows} />
            <FemHighlightView meshData={meshData} selectedFaces={selectedFaces} center={geomCenter} />
          </>
        ) : null}
        {antennaOverlays.length > 0 && !scopeObjectId ? (
          <AntennaOverlayMeshes
            overlays={antennaOverlays}
            geomCenter={geomCenter}
            selectedAntennaId={selectedAntennaId}
            onAntennaTranslate={onAntennaTranslate}
          />
        ) : null}
        {!scopeObjectId ? (
          <SceneAxes3D worldExtent={axesWorldExtent} center={axesCenter} sceneScale={[1, 1, 1]} />
        ) : null}
        
        <SyncedControls controlsRefObject={controlsRef} viewCubeBridgeRef={viewCubeSceneRef} />
      </Canvas>
      {missingExactScopeSegment && scopeObjectId ? (
        <div className="pointer-events-none absolute inset-x-4 top-16 z-20 rounded-xl border border-rose-400/25 bg-background/85 px-4 py-3 text-sm text-rose-200 shadow-lg backdrop-blur-md">
          Object mesh segmentation unavailable for shared-domain FEM: `{scopeObjectId}`
        </div>
      ) : null}

      {/* ─── Toolbar ────────────────────────────────── */}
      {toolbarMode !== "hidden" && (
        <div className="absolute top-2 left-2 right-2 flex flex-wrap items-center gap-1 z-10 pointer-events-none [&>*]:pointer-events-auto">
          {/* Render mode */}
          <div className="flex items-center gap-1 p-1 rounded bg-card/50 backdrop-blur-md border border-border/50">
            <span className="text-[0.65rem] font-bold uppercase tracking-widest text-muted-foreground px-1 select-none">Render</span>
            {RENDER_OPTIONS.map((opt) => (
              <button key={opt.value} className="appearance-none border-none bg-transparent text-muted-foreground text-[0.65rem] font-semibold uppercase tracking-widest px-2 py-1 rounded cursor-pointer transition-colors leading-[1.35] hover:bg-muted/50 hover:text-foreground data-[active=true]:bg-primary/20 data-[active=true]:text-primary" data-active={renderMode === opt.value} onClick={() => onRenderModeChange ? onRenderModeChange(opt.value) : setInternalRenderMode(opt.value)}>{opt.label}</button>
            ))}
          </div>
          {/* Color field */}
          <div className="flex items-center gap-1 p-1 rounded bg-card/50 backdrop-blur-md border border-border/50">
            <span className="text-[0.65rem] font-bold uppercase tracking-widest text-muted-foreground px-1 select-none">Color</span>
            {COLOR_OPTIONS.map((opt) => (
              <button key={opt.value} className="appearance-none border-none bg-transparent text-muted-foreground text-[0.65rem] font-semibold uppercase tracking-widest px-2 py-1 rounded cursor-pointer transition-colors leading-[1.35] hover:bg-muted/50 hover:text-foreground data-[active=true]:bg-primary/20 data-[active=true]:text-primary" data-active={field === opt.value} onClick={() => setField(opt.value)}>{opt.label}</button>
            ))}
          </div>
          {/* Clip */}
          <div className="flex items-center gap-1 p-1 rounded bg-card/50 backdrop-blur-md border border-border/50 relative">
            <button className="appearance-none border-none bg-transparent text-muted-foreground text-[0.65rem] font-semibold uppercase tracking-widest px-2 py-1 rounded cursor-pointer transition-colors leading-[1.35] hover:bg-muted/50 hover:text-foreground data-[active=true]:bg-primary/20 data-[active=true]:text-primary" data-active={clipEnabled} onClick={() => { const v = !clipEnabled; onClipEnabledChange ? onClipEnabledChange(v) : setInternalClipEnabled(v); if (v) setShowClipDrop(true); }}>✂ Clip</button>
            {clipEnabled && <button className="appearance-none border-none bg-transparent text-muted-foreground font-semibold px-1.5 py-1 rounded cursor-pointer transition-colors leading-none text-base hover:bg-muted/50" onClick={() => setShowClipDrop((v) => !v)}>▾</button>}
            {showClipDrop && clipEnabled && (
              <div className="absolute top-[calc(100%+0.35rem)] left-0 min-w-[200px] p-2.5 rounded-md bg-popover/95 backdrop-blur-md border border-border/50 shadow-lg z-20 grid gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-[0.65rem] font-semibold text-muted-foreground min-w-[48px] uppercase tracking-widest">Axis</span>
                  {(["x","y","z"] as ClipAxis[]).map(a => <button key={a} className="appearance-none border-none bg-transparent text-muted-foreground text-[0.65rem] font-semibold uppercase tracking-widest px-1.5 py-1 rounded cursor-pointer transition-colors data-[active=true]:bg-primary/20 data-[active=true]:text-primary" data-active={clipAxis === a} onClick={() => onClipAxisChange ? onClipAxisChange(a) : setInternalClipAxis(a)}>{a.toUpperCase()}</button>)}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[0.65rem] font-semibold text-muted-foreground min-w-[48px] uppercase tracking-widest">Pos</span>
                  <input type="range" className="flex-1 h-[3px] accent-primary" min={0} max={100} value={clipPos} onChange={(e) => { const v = Number(e.target.value); onClipPosChange ? onClipPosChange(v) : setInternalClipPos(v); }} />
                </div>
                <button className="text-muted-foreground/70 text-[0.64rem] font-semibold uppercase tracking-widest hover:bg-muted/50" onClick={() => setShowClipDrop(false)}>Close</button>
              </div>
            )}
          </div>
          {/* Opacity */}
          <div className="flex items-center gap-1 p-1 rounded bg-card/50 backdrop-blur-md border border-border/50">
            <span className="text-[0.65rem] font-bold uppercase tracking-widest text-muted-foreground px-1 select-none">Opac</span>
            <input type="range" className="w-[50px] h-[3px] accent-primary" min={10} max={100} value={opacity} onChange={(e) => { const v = Number(e.target.value); onOpacityChange ? onOpacityChange(v) : setInternalOpacity(v); }} />
          </div>
          {/* Shrink */}
          {meshData.elements.length >= 4 && (
            <div className="flex items-center gap-1 p-1 rounded bg-card/50 backdrop-blur-md border border-border/50">
              <span className="text-[0.65rem] font-bold uppercase tracking-widest text-muted-foreground px-1 select-none" title="Shrink Elements">Shrink</span>
              <input type="range" className="w-[50px] h-[3px] accent-primary" min={10} max={100} value={Math.round(shrinkFactor * 100)} onChange={(e) => { const v = Number(e.target.value) / 100; onShrinkFactorChange ? onShrinkFactorChange(v) : setInternalShrinkFactor(v); }} />
            </div>
          )}
          {/* Arrows */}
          <div className="flex items-center gap-1 p-1 rounded bg-card/50 backdrop-blur-md border border-border/50">
            <button className="appearance-none border-none bg-transparent text-muted-foreground text-[0.65rem] font-semibold uppercase tracking-widest px-2 py-1 rounded cursor-pointer transition-colors data-[active=true]:bg-primary/20 data-[active=true]:text-primary" data-active={showArrows} onClick={() => { const v = !showArrows; onShowArrowsChange ? onShowArrowsChange(v) : setInternalShowArrows(v); }}>↗ Arrows</button>
            {showArrows && <input type="range" className="w-[50px] h-[3px] accent-primary" min={200} max={3000} step={100} value={arrowDensity} onChange={(e) => setArrowDensity(Number(e.target.value))} />}
          </div>
          <div className="w-px h-[20px] bg-border/50 mx-0.5 shrink-0" />
          <div className="flex items-center gap-1 p-1 rounded bg-card/50 backdrop-blur-md border border-border/50">
            {(["reset", "front", "top", "right"] as const).map(view => (
              <button key={view} className="text-muted-foreground text-[0.65rem] font-semibold uppercase tracking-widest px-2 py-1 hover:bg-muted/50" onClick={() => setCameraPreset(view)}>{view === "reset" ? "⟲" : view[0].toUpperCase()}</button>
            ))}
          </div>
          <div className="flex items-center gap-1 p-1 rounded bg-card/50 backdrop-blur-md border border-border/50">
            <button className="text-muted-foreground font-semibold px-1.5 py-1 hover:bg-muted/50" onClick={takeScreenshot} title="Screenshot">📷</button>
          </div>
        </div>
      )}

      <div className="absolute bottom-3 left-3 text-[0.65rem] text-slate-300 font-mono pointer-events-none flex items-baseline gap-3 bg-slate-900/80 backdrop-blur-md px-3 py-1.5 rounded-md border border-slate-500/30 shadow-md z-20">
        <span>{meshData.nNodes.toLocaleString()} nodes</span><span className="w-[3px] h-[3px] rounded-full bg-slate-500/50" />
        <span>{meshData.nElements.toLocaleString()} tets</span><span className="w-[3px] h-[3px] rounded-full bg-slate-500/50" />
        <span>{(meshData.boundaryFaces.length / 3).toLocaleString()} faces</span>
        {clipEnabled && <><span className="w-[3px] h-[3px] rounded-full bg-slate-500/50" /><span className="text-amber-500">clip {clipAxis.toUpperCase()} @ {clipPos}%</span></>}
        {selectedFaces.length > 0 && <><span className="w-[3px] h-[3px] rounded-full bg-slate-500/50" /><span className="text-blue-400">{selectedFaces.length} selected</span></>}
      </div>

      {/* ── Lasso refine floating toolbar ── */}
      {selectedFaces.length > 0 && onRefine && (
        <div className="absolute bottom-12 left-1/2 -translate-x-1/2 flex items-center gap-2 p-2 rounded-lg bg-slate-900/90 backdrop-blur-md border border-slate-500/30 shadow-xl z-30 pointer-events-auto">
          <span className="text-[0.65rem] font-mono text-slate-400 px-1">{selectedFaces.length} faces</span>
          <div className="w-px h-4 bg-slate-500/30" />
          <button className="text-[0.65rem] font-semibold uppercase tracking-widest text-emerald-400 hover:text-emerald-300 px-2 py-1 rounded hover:bg-emerald-500/10 transition-colors" onClick={() => { onRefine(selectedFaces, 0.5); setSelectedFaces([]); }}>Refine ×2</button>
          <button className="text-[0.65rem] font-semibold uppercase tracking-widest text-emerald-400 hover:text-emerald-300 px-2 py-1 rounded hover:bg-emerald-500/10 transition-colors" onClick={() => { onRefine(selectedFaces, 0.25); setSelectedFaces([]); }}>Refine ×4</button>
          <button className="text-[0.65rem] font-semibold uppercase tracking-widest text-amber-400 hover:text-amber-300 px-2 py-1 rounded hover:bg-amber-500/10 transition-colors" onClick={() => { onRefine(selectedFaces, 2.0); setSelectedFaces([]); }}>Coarsen ×2</button>
          <div className="w-px h-4 bg-slate-500/30" />
          <button className="text-[0.65rem] font-semibold uppercase tracking-widest text-slate-400 hover:text-slate-200 px-2 py-1 rounded hover:bg-slate-500/10 transition-colors" onClick={() => setSelectedFaces([])}>Clear</button>
        </div>
      )}

      <ViewCube sceneRef={viewCubeSceneRef} onRotate={handleViewCubeRotate} />
      {showOrientationLegend && <HslSphere sceneRef={viewCubeSceneRef} />}

      {hoveredFaceInfo && hoveredFace && (
        <div style={{ left: hoveredFace.x + 14, top: hoveredFace.y - 8 }} className="absolute z-40 px-2.5 py-1 rounded-md bg-slate-900/90 border border-slate-500/20 text-[0.68rem] font-mono text-slate-200/85 pointer-events-none whitespace-nowrap shadow-md">
          face #{hoveredFaceInfo.faceIdx} · AR {hoveredFaceInfo.ar.toFixed(2)}
          {hoveredFaceInfo.sicn != null && ` · SICN ${hoveredFaceInfo.sicn.toFixed(3)}`}
        </div>
      )}

      {ctxMenu && (
        <div style={{ left: ctxMenu.x, top: ctxMenu.y }} className="absolute z-50 min-w-[180px] py-1 rounded-lg bg-gradient-to-b from-slate-800/95 to-slate-900/95 border border-slate-500/20 shadow-xl backdrop-blur-md" onClick={(e) => e.stopPropagation()}>
          <button className="flex items-center gap-2 w-full px-3.5 py-1.5 text-[0.73rem] text-slate-200 text-left hover:bg-slate-500/15" onClick={() => { setSelectedFaces([ctxMenu.faceIdx]); setCtxMenu(null); }}><span className="text-xs w-4">🔍</span> Inspect face #{ctxMenu.faceIdx}</button>
          <button className="flex items-center gap-2 w-full px-3.5 py-1.5 text-[0.73rem] text-slate-200 text-left hover:bg-slate-500/15" onClick={() => { setField("quality"); setCtxMenu(null); }}><span className="text-xs w-4">📊</span> Show quality (AR)</button>
          <div className="h-px mx-2.5 my-1 bg-slate-500/15" />
          <button className="flex items-center gap-2 w-full px-3.5 py-1.5 text-[0.73rem] text-slate-200 text-left hover:bg-slate-500/15" onClick={() => { const v = !clipEnabled; onClipEnabledChange ? onClipEnabledChange(v) : setInternalClipEnabled(v); setCtxMenu(null); }}><span className="text-xs w-4">✂️</span> {clipEnabled ? "Disable clip" : "Enable clip"}</button>
          {selectedFaces.length > 0 && (
            <button className="flex items-center gap-2 w-full px-3.5 py-1.5 text-[0.73rem] text-slate-200 text-left hover:bg-slate-500/15 border-t border-slate-500/15 mt-1 pt-1.5" onClick={() => { setSelectedFaces([]); setCtxMenu(null); }}><span className="text-xs w-4 text-center opacity-70">✕</span> Clear selection</button>
          )}
        </div>
      )}
    </div>
  );
}

export default memo(FemMeshView3DInner);
