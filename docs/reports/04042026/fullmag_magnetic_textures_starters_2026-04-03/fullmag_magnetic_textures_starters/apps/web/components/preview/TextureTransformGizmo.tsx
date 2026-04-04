"use client";

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { PivotControls } from "@react-three/drei";
import type { TextureTransform3D } from "@/lib/textureTransform";

export type TextureGizmoMode = "translate" | "rotate" | "scale";

interface Props {
  transform: TextureTransform3D;
  mode: TextureGizmoMode;
  visible?: boolean;
  onCommit?: (next: TextureTransform3D) => void;
}

function toObject3DTransform(transform: TextureTransform3D) {
  const position = new THREE.Vector3(...transform.translation);
  const quaternion = new THREE.Quaternion(...transform.rotationQuat);
  const scale = new THREE.Vector3(...transform.scale);
  return { position, quaternion, scale };
}

export default function TextureTransformGizmo({
  transform,
  mode,
  visible = true,
  onCommit,
}: Props) {
  const groupRef = useRef<THREE.Group>(null);

  const initial = useMemo(() => toObject3DTransform(transform), [transform]);

  useEffect(() => {
    if (!groupRef.current) return;
    groupRef.current.position.copy(initial.position);
    groupRef.current.quaternion.copy(initial.quaternion);
    groupRef.current.scale.copy(initial.scale);
  }, [initial]);

  if (!visible) {
    return null;
  }

  return (
    <PivotControls
      depthTest={false}
      fixed
      scale={75}
      lineWidth={2}
      disableAxes={false}
      activeAxes={[true, true, true]}
      disableRotations={mode !== "rotate"}
      disableSliders={false}
      disableScaling={mode !== "scale"}
      onDragEnd={() => {
        const group = groupRef.current;
        if (!group || !onCommit) {
          return;
        }
        onCommit({
          translation: [group.position.x, group.position.y, group.position.z],
          rotationQuat: [
            group.quaternion.x,
            group.quaternion.y,
            group.quaternion.z,
            group.quaternion.w,
          ],
          scale: [group.scale.x, group.scale.y, group.scale.z],
          pivot: [...transform.pivot] as [number, number, number],
        });
      }}
    >
      <group ref={groupRef}>
        <mesh>
          <boxGeometry args={[1, 1, 1]} />
          <meshBasicMaterial color="#67e8f9" wireframe transparent opacity={0.3} />
        </mesh>
      </group>
    </PivotControls>
  );
}
