"use client";

import { useRef, useCallback } from "react";
import * as THREE from "three";
import { PivotControls } from "@react-three/drei";
import type { ObjectTransform } from "./types";
import { IDENTITY_TRANSFORM } from "./types";

interface TransformGizmoLayerProps {
  /** Whether gizmo is active (object selected + tool is move/rotate/scale) */
  active: boolean;
  /** Which axes to show — defaults to all */
  activeAxes?: [boolean, boolean, boolean];
  /** Fixed pixel size for gizmo */
  scale?: number;
  /** Callback when drag ends with translation delta */
  onTranslate?: (dx: number, dy: number, dz: number) => void;
  children: React.ReactNode;
}

/**
 * Unified transform gizmo layer.
 * Wraps children in PivotControls when active.
 * Extracts translation delta on drag end and resets group position.
 */
export function TransformGizmoLayer({
  active,
  activeAxes = [true, true, true],
  scale = 75,
  onTranslate,
  children,
}: TransformGizmoLayerProps) {
  const groupRef = useRef<THREE.Group>(null);

  const handleDragEnd = useCallback(() => {
    if (!groupRef.current || !onTranslate) return;
    const p = groupRef.current.position;
    if (Math.abs(p.x) > 1e-12 || Math.abs(p.y) > 1e-12 || Math.abs(p.z) > 1e-12) {
      onTranslate(p.x, p.y, p.z);
    }
    groupRef.current.position.set(0, 0, 0);
  }, [onTranslate]);

  if (!active) {
    return <>{children}</>;
  }

  return (
    <PivotControls
      depthTest={false}
      lineWidth={2}
      axisColors={["#f87171", "#4ade80", "#60a5fa"]}
      scale={scale}
      fixed
      activeAxes={activeAxes}
      onDragEnd={handleDragEnd}
    >
      <group ref={groupRef}>{children}</group>
    </PivotControls>
  );
}
