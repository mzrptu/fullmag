"use client";

import { ReactNode, useCallback, useEffect, useMemo, useRef, type MutableRefObject } from "react";
import * as THREE from "three";
import { Canvas, useThree } from "@react-three/fiber";
import {
  OrthographicCamera,
  PerspectiveCamera,
  OrbitControls,
  TrackballControls,
} from "@react-three/drei";
import { getViewportQualityProfile, type ViewportQualityProfileId } from "./viewportQualityProfiles";
import ViewportGizmoStack from "./ViewportGizmoStack";

export type ShellProjection = "perspective" | "orthographic";
export type ShellNavigation = "trackball" | "cad";
export type ViewportFrameloopMode = "always" | "demand" | "never";

export interface ViewportRenderPolicy {
  mode: "always" | "demand" | "paused";
  hidden: boolean;
  interactionActive: boolean;
}

interface ScientificViewportShellProps {
  children: ReactNode;
  toolbar?: ReactNode;
  hud?: ReactNode;
  gizmos?: ReactNode;
  backgroundColor?: number;
  projection?: ShellProjection;
  navigation?: ShellNavigation;
  qualityProfile?: ViewportQualityProfileId;
  target?: [number, number, number];
  onViewCubeRotate?: (quat: THREE.Quaternion) => void;
  onResetView?: () => void;
  showOrientationSphere?: boolean;
  orientationSphereAxisConvention?: "identity" | "swapYZ";
  orientationSpherePositionClassName?: string;
  bridgeRef?: MutableRefObject<any> | null;
  controlsRef?: MutableRefObject<any> | null;
  onCanvasCreated?: (payload: { gl: THREE.WebGLRenderer; camera: THREE.Camera }) => void;
  onPointerMissed?: () => void;
  onCanvasContextMenu?: React.MouseEventHandler<Element>;
  renderDefaultGizmos?: boolean;
  renderPolicy?: Partial<ViewportRenderPolicy>;
  onInteractionChange?: (active: boolean) => void;
}

function ShellCamera({ projection }: { projection: ShellProjection }) {
  if (projection === "orthographic") {
    return (
      <OrthographicCamera
        makeDefault
        position={[3, 2.4, 3]}
        near={0.0001}
        far={10000}
        zoom={80}
      />
    );
  }
  return (
    <PerspectiveCamera
      makeDefault
      position={[3, 2.4, 3]}
      fov={45}
      near={0.0001}
      far={10000}
    />
  );
}

function ShellControls({
  navigation,
  target,
  controlsRef,
  onInteractionChange,
}: {
  navigation: ShellNavigation;
  target: [number, number, number];
  controlsRef: React.MutableRefObject<any>;
  onInteractionChange?: (active: boolean) => void;
}) {
  const handleStart = useCallback(() => {
    onInteractionChange?.(true);
  }, [onInteractionChange]);
  const handleEnd = useCallback(() => {
    onInteractionChange?.(false);
  }, [onInteractionChange]);

  if (navigation === "cad") {
    return (
      <OrbitControls
        ref={controlsRef}
        enableDamping
        dampingFactor={0.08}
        rotateSpeed={0.85}
        zoomSpeed={0.85}
        panSpeed={0.9}
        screenSpacePanning
        target={target}
        onStart={handleStart}
        onEnd={handleEnd}
      />
    );
  }

  return (
    <TrackballControls
      ref={controlsRef}
      rotateSpeed={2.4}
      zoomSpeed={1.2}
      panSpeed={0.85}
      target={target}
      onStart={handleStart}
      onEnd={handleEnd}
    />
  );
}

function ShellBridgeSync({
  bridgeRef,
  controlsRef,
}: {
  bridgeRef: MutableRefObject<any> | null;
  controlsRef: MutableRefObject<any>;
}) {
  const { camera } = useThree();
  useEffect(() => {
    if (bridgeRef) {
      bridgeRef.current = { camera, controls: controlsRef.current };
    }
  }, [bridgeRef, camera, controlsRef]);
  return null;
}

export default function ScientificViewportShell({
  children,
  toolbar,
  hud,
  gizmos,
  backgroundColor = 0x1e1e2e,
  projection = "perspective",
  navigation = "trackball",
  qualityProfile = "interactive",
  target = [0, 0, 0],
  onViewCubeRotate,
  onResetView,
  showOrientationSphere = false,
  orientationSphereAxisConvention = "identity",
  orientationSpherePositionClassName,
  bridgeRef = null,
  controlsRef: externalControlsRef = null,
  onCanvasCreated,
  onPointerMissed,
  onCanvasContextMenu,
  renderDefaultGizmos = true,
  renderPolicy,
  onInteractionChange,
}: ScientificViewportShellProps) {
  const internalBridgeRef = useRef<any>(null);
  const internalControlsRef = useRef<any>(null);
  const effectiveBridgeRef = bridgeRef ?? internalBridgeRef;
  const effectiveControlsRef = externalControlsRef ?? internalControlsRef;
  const profile = getViewportQualityProfile(qualityProfile);
  const interactionActiveRef = useRef(false);
  const resolvedRenderMode = renderPolicy?.mode ?? "demand";
  const resolvedHidden = renderPolicy?.hidden ?? false;
  const frameloop: ViewportFrameloopMode =
    resolvedHidden || resolvedRenderMode === "paused"
      ? "never"
      : resolvedRenderMode === "always"
        ? "always"
        : "demand";
  const handleInteractionChange = useCallback((next: boolean) => {
    if (interactionActiveRef.current === next) {
      return;
    }
    interactionActiveRef.current = next;
    onInteractionChange?.(next);
  }, [onInteractionChange]);

  const glOptions = useMemo(
    () => ({
      antialias: profile.antialias,
      preserveDrawingBuffer: profile.preserveDrawingBuffer,
      localClippingEnabled: true,
    }),
    [profile.antialias, profile.preserveDrawingBuffer],
  );

  return (
    <div className="relative flex h-full w-full min-h-0 min-w-0 overflow-hidden rounded-md bg-background">
      <Canvas
        frameloop={frameloop}
        gl={glOptions}
        dpr={Math.min(
          typeof window !== "undefined" ? window.devicePixelRatio : 1,
          profile.dprCap,
        )}
        onPointerMissed={onPointerMissed}
        onContextMenu={onCanvasContextMenu}
        onCreated={({ gl, camera }) => {
          if (profile.toneMapping === "aces") {
            gl.toneMapping = THREE.ACESFilmicToneMapping;
            gl.toneMappingExposure = 1.05;
          } else {
            gl.toneMapping = THREE.NoToneMapping;
          }
          if (effectiveBridgeRef) {
            effectiveBridgeRef.current = { camera, controls: effectiveControlsRef.current };
          }
          onCanvasCreated?.({ gl, camera });
        }}
      >
        <ShellCamera projection={projection} />
        <color attach="background" args={[backgroundColor]} />
        <ambientLight intensity={0.32} />
        <directionalLight position={[1.5, 2.5, 3.5]} intensity={1.0} />
        <directionalLight position={[-1.2, -1.4, -2.5]} intensity={0.28} />
        <hemisphereLight intensity={0.24} />
        {children}
        <ShellControls
          navigation={navigation}
          target={target}
          controlsRef={effectiveControlsRef}
          onInteractionChange={handleInteractionChange}
        />
        <ShellBridgeSync bridgeRef={effectiveBridgeRef} controlsRef={effectiveControlsRef} />
      </Canvas>

      {toolbar}
      {hud}
      {gizmos ?? (renderDefaultGizmos ? (
        <ViewportGizmoStack
          sceneRef={effectiveBridgeRef}
          onRotate={onViewCubeRotate}
          onReset={onResetView}
          showOrientationSphere={showOrientationSphere}
          orientationSphereAxisConvention={orientationSphereAxisConvention}
          orientationSpherePositionClassName={orientationSpherePositionClassName}
        />
      ) : null)}
    </div>
  );
}
