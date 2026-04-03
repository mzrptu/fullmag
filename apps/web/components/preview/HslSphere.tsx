"use client";

/**
 * HSL Colour Sphere – R3F version.
 *
 * A small inset 3D colour reference that rotates in sync with the main
 * viewport camera. The sphere surface uses the exact same magnetizationHSL
 * colour mapping as arrow/voxel rendering.
 *
 * Axis labels (X / Y / Z) protrude from the sphere following the active
 * viewport convention. FEM uses identity axes; FDM swaps Y/Z.
 */

import { useRef, useMemo } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Text, Billboard, Line } from "@react-three/drei";
import { magnetizationHslColor } from "./magnetizationColor";

/* ── Types ─────────────────────────────────────────────────── */

interface HslSphereProps {
  sceneRef: React.MutableRefObject<{
    camera: THREE.PerspectiveCamera | THREE.Camera;
    controls: any;
  } | null>;
  axisConvention?: "identity" | "swapYZ";
  positionClassName?: string;
}

/* ── Constants ─────────────────────────────────────────────── */

const SIZE = 110;
const SPHERE_RADIUS = 0.9;
const SEGMENTS = 64;
const LABEL_DIST = 1.18;

/* ── Axis label component ─────────────────────────────────── */

function AxisLabel({ text, color, position }: {
  text: string;
  color: string;
  position: [number, number, number];
}) {
  return (
    <Billboard position={position}>
      <Text
        fontSize={0.28}
        color={color}
        anchorX="center"
        anchorY="middle"
        fontWeight="bold"
      >
        {text}
      </Text>
    </Billboard>
  );
}

/* ── Camera sync component ────────────────────────────────── */

function CameraSync({
  mainCameraRef,
}: {
  mainCameraRef: React.MutableRefObject<{ camera: THREE.Camera } | null>;
}) {
  const { camera } = useThree();

  useFrame(() => {
    const main = mainCameraRef.current;
    if (!main) return;

    // Copy only the rotation from the main camera
    camera.quaternion.copy(main.camera.quaternion);
    camera.position.set(0, 0, 3).applyQuaternion(camera.quaternion);
    camera.lookAt(0, 0, 0);
  });

  return null;
}

/* ── Component ─────────────────────────────────────────────── */

export default function HslSphere({
  sceneRef,
  axisConvention = "identity",
  positionClassName = "bottom-4 left-4",
}: HslSphereProps) {
  return (
    <div className={`pointer-events-none absolute z-10 h-[110px] w-[110px] ${positionClassName}`}>
      <Canvas
        orthographic
        camera={{
          left: -1.4,
          right: 1.4,
          top: 1.4,
          bottom: -1.4,
          near: 0.1,
          far: 10,
          position: [0, 0, 3],
        }}
        gl={{ alpha: true, antialias: true }}
        dpr={Math.min(typeof window !== "undefined" ? window.devicePixelRatio : 1, 2)}
        style={{
          width: SIZE,
          height: SIZE,
          borderRadius: "50%",
          overflow: "hidden",
        }}
      >
        <HslSphereScene mainCameraRef={sceneRef} axisConvention={axisConvention} />
      </Canvas>
    </div>
  );
}

/* ── Inner scene (must be inside Canvas) ───────────────────── */

function HslSphereScene({
  mainCameraRef,
  axisConvention,
}: {
  mainCameraRef: React.MutableRefObject<{ camera: THREE.Camera } | null>;
  axisConvention: "identity" | "swapYZ";
}) {
  const sphereGeo = useMemo(() => {
    const geo = new THREE.SphereGeometry(SPHERE_RADIUS, SEGMENTS, SEGMENTS);
    const posAttr = geo.attributes.position;
    const colors = new Float32Array(posAttr.count * 3);
    const v = new THREE.Vector3();

    for (let i = 0; i < posAttr.count; i++) {
      v.set(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i)).normalize();
      const c =
        axisConvention === "swapYZ"
          ? magnetizationHslColor(v.x, v.z, v.y)
          : magnetizationHslColor(v.x, v.y, v.z);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }

    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    return geo;
  }, [axisConvention]);
  const sphereMat = useMemo(
    () => new THREE.MeshBasicMaterial({ vertexColors: true }),
    [],
  );

  return (
    <>
      <CameraSync mainCameraRef={mainCameraRef} />

      {/* Vertex-coloured sphere */}
      <mesh geometry={sphereGeo} material={sphereMat} />

      {/* Axis labels — visual XYZ reference for the active viewport convention */}
      <AxisLabel text="X" color="#e65050" position={[LABEL_DIST, 0, 0]} />
      <AxisLabel text="X" color="#e65050" position={[-LABEL_DIST, 0, 0]} />
      <AxisLabel text="Z" color="#5090e6" position={[0, LABEL_DIST, 0]} />
      <AxisLabel text="Z" color="#5090e6" position={[0, -LABEL_DIST, 0]} />
      <AxisLabel text="Y" color="#50c850" position={[0, 0, LABEL_DIST]} />
      <AxisLabel text="Y" color="#50c850" position={[0, 0, -LABEL_DIST]} />

      {/* Thin axis lines through sphere */}
      <Line
        points={[[-1.05, 0, 0], [1.05, 0, 0]]}
        color="#e65050"
        lineWidth={1}
        transparent
        opacity={0.5}
      />
      <Line
        points={[[0, -1.05, 0], [0, 1.05, 0]]}
        color="#5090e6"
        lineWidth={1}
        transparent
        opacity={0.5}
      />
      <Line
        points={[[0, 0, -1.05], [0, 0, 1.05]]}
        color="#50c850"
        lineWidth={1}
        transparent
        opacity={0.5}
      />
    </>
  );
}
