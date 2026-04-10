"use client";

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { PivotControls } from "@react-three/drei";
import type { TextureTransform3D } from "@/lib/textureTransform";

export type TextureGizmoMode = "translate" | "rotate" | "scale";
export type TexturePreviewProxy = "none" | "disc" | "box" | "cylinder" | "wall" | "wave";

interface Props {
  transform: TextureTransform3D;
  mode: TextureGizmoMode;
  visible?: boolean;
  previewProxy?: TexturePreviewProxy;
  onLiveChange?: (next: TextureTransform3D) => void;
  onCommit?: (next: TextureTransform3D) => void;
}

function toObject3DTransform(transform: TextureTransform3D) {
  const position = new THREE.Vector3(...transform.translation);
  const quaternion = new THREE.Quaternion(...transform.rotation_quat);
  const scale = new THREE.Vector3(...transform.scale);
  return { position, quaternion, scale };
}

function snapshotGroupTransform(
  group: THREE.Group,
  pivot: [number, number, number],
): TextureTransform3D {
  return {
    translation: [group.position.x, group.position.y, group.position.z],
    rotation_quat: [
      group.quaternion.x,
      group.quaternion.y,
      group.quaternion.z,
      group.quaternion.w,
    ],
    scale: [group.scale.x, group.scale.y, group.scale.z],
    pivot: [...pivot] as [number, number, number],
  };
}

function PreviewProxyMesh({ proxy }: { proxy: TexturePreviewProxy }) {
  if (proxy === "none") {
    return (
      <mesh>
        <sphereGeometry args={[0.18, 20, 20]} />
        <meshBasicMaterial color="#89dceb" wireframe transparent opacity={0.55} />
      </mesh>
    );
  }
  if (proxy === "disc") {
    return (
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.7, 0.7, 0.06, 48, 1, true]} />
        <meshBasicMaterial color="#89dceb" wireframe transparent opacity={0.4} />
      </mesh>
    );
  }
  if (proxy === "cylinder") {
    return (
      <mesh>
        <cylinderGeometry args={[0.45, 0.45, 1.2, 28, 1, true]} />
        <meshBasicMaterial color="#89dceb" wireframe transparent opacity={0.35} />
      </mesh>
    );
  }
  if (proxy === "wall") {
    return (
      <group>
        <mesh>
          <boxGeometry args={[0.2, 1.2, 1.2]} />
          <meshBasicMaterial color="#89dceb" wireframe transparent opacity={0.4} />
        </mesh>
        <mesh position={[0.4, 0, 0]}>
          <boxGeometry args={[0.6, 1.2, 1.2]} />
          <meshBasicMaterial color="#f38ba8" wireframe transparent opacity={0.15} />
        </mesh>
        <mesh position={[-0.4, 0, 0]}>
          <boxGeometry args={[0.6, 1.2, 1.2]} />
          <meshBasicMaterial color="#89b4fa" wireframe transparent opacity={0.15} />
        </mesh>
      </group>
    );
  }
  if (proxy === "wave") {
    return (
      <group>
        <mesh>
          <boxGeometry args={[1.5, 0.6, 0.6]} />
          <meshBasicMaterial color="#89dceb" wireframe transparent opacity={0.25} />
        </mesh>
        <mesh rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.02, 0.02, 1.8, 8]} />
          <meshBasicMaterial color="#f5c2e7" transparent opacity={0.8} />
        </mesh>
      </group>
    );
  }
  return (
    <mesh>
      <boxGeometry args={[1, 1, 1]} />
      <meshBasicMaterial color="#89dceb" wireframe transparent opacity={0.3} />
    </mesh>
  );
}

export default function TextureTransformGizmo({
  transform,
  mode,
  visible = true,
  previewProxy = "box",
  onLiveChange,
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
      onDrag={() => {
        const group = groupRef.current;
        if (!group || !onLiveChange) {
          return;
        }
        onLiveChange(snapshotGroupTransform(group, transform.pivot));
      }}
      onDragEnd={() => {
        const group = groupRef.current;
        if (!group || !onCommit) {
          return;
        }
        onCommit(snapshotGroupTransform(group, transform.pivot));
      }}
    >
      <group ref={groupRef}>
        <PreviewProxyMesh proxy={previewProxy} />
      </group>
    </PivotControls>
  );
}
