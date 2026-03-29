import React, { useMemo, useEffect, useRef, useCallback } from "react";
import * as THREE from "three";
import { useThree } from "@react-three/fiber";
import { FemMeshData, FemColorField, RenderMode } from "../FemMeshView3D";
import { computeFaceAspectRatios, qualityColor, sicnQualityColor, divergingColor, magnitudeColor } from "./colorUtils";
import { applyMagnetizationHsl } from "../magnetizationColor";

interface FemGeometryProps {
  meshData: FemMeshData;
  field: FemColorField;
  renderMode: RenderMode;
  opacity: number;
  qualityPerFace?: number[] | null;
  onGeometryCenter?: (center: THREE.Vector3, maxDim: number, size: THREE.Vector3) => void;
  onFaceClick?: (e: any) => void;
  onFaceHover?: (e: any) => void;
  onFaceUnhover?: (e: any) => void;
  onFaceContextMenu?: (e: any) => void;
}

/* ── Helper: compute vertex colors from field data ─────────────────── */
function computeVertexColors(
  nNodes: number,
  field: FemColorField,
  fieldData: FemMeshData["fieldData"] | undefined,
  nodes: number[],
  boundaryFaces: number[],
  qualityPerFace?: number[] | null,
): Float32Array {
  const colors = new Float32Array(nNodes * 3);
  const _c = new THREE.Color();
  const nFaces = boundaryFaces.length / 3;

  if (field === "quality") {
    const faceARs = computeFaceAspectRatios(nodes, boundaryFaces);
    const vertexAR = new Float32Array(nNodes);
    const vertexCount = new Uint16Array(nNodes);
    for (let f = 0; f < nFaces; f++) {
      const ar = faceARs[f];
      for (let v = 0; v < 3; v++) {
        const vi = boundaryFaces[f * 3 + v];
        vertexAR[vi] += ar;
        vertexCount[vi]++;
      }
    }
    for (let i = 0; i < nNodes; i++) {
      const avg = vertexCount[i] > 0 ? vertexAR[i] / vertexCount[i] : 1;
      qualityColor(avg, _c);
      colors[i * 3] = _c.r; colors[i * 3 + 1] = _c.g; colors[i * 3 + 2] = _c.b;
    }
  } else if (field === "sicn") {
    if (qualityPerFace && qualityPerFace.length === nFaces) {
      const vertexSICN = new Float32Array(nNodes);
      const vertexCount = new Uint16Array(nNodes);
      for (let f = 0; f < nFaces; f++) {
        const val = qualityPerFace[f];
        for (let v = 0; v < 3; v++) {
          const vi = boundaryFaces[f * 3 + v];
          vertexSICN[vi] += val;
          vertexCount[vi]++;
        }
      }
      for (let i = 0; i < nNodes; i++) {
        const avg = vertexCount[i] > 0 ? vertexSICN[i] / vertexCount[i] : 0;
        sicnQualityColor(avg, _c);
        colors[i * 3] = _c.r; colors[i * 3 + 1] = _c.g; colors[i * 3 + 2] = _c.b;
      }
    } else {
      // Fallback to aspect ratio
      const faceARs = computeFaceAspectRatios(nodes, boundaryFaces);
      const vertexAR = new Float32Array(nNodes);
      const vertexCount = new Uint16Array(nNodes);
      for (let f = 0; f < nFaces; f++) {
        for (let v = 0; v < 3; v++) {
          const vi = boundaryFaces[f * 3 + v];
          vertexAR[vi] += faceARs[f];
          vertexCount[vi]++;
        }
      }
      for (let i = 0; i < nNodes; i++) {
        const avg = vertexCount[i] > 0 ? vertexAR[i] / vertexCount[i] : 1;
        qualityColor(avg, _c);
        colors[i * 3] = _c.r; colors[i * 3 + 1] = _c.g; colors[i * 3 + 2] = _c.b;
      }
    }
  } else {
    const fld = fieldData;
    let scaleX = 1, scaleY = 1, scaleZ = 1, scaleMagnitude = 1;
    if (fld) {
      let maxAbsX = 0, maxAbsY = 0, maxAbsZ = 0, maxMag = 0;
      for (let i = 0; i < nNodes; i++) {
        const fx = fld.x[i] ?? 0, fy = fld.y[i] ?? 0, fz = fld.z[i] ?? 0;
        maxAbsX = Math.max(maxAbsX, Math.abs(fx));
        maxAbsY = Math.max(maxAbsY, Math.abs(fy));
        maxAbsZ = Math.max(maxAbsZ, Math.abs(fz));
        maxMag = Math.max(maxMag, Math.sqrt(fx * fx + fy * fy + fz * fz));
      }
      scaleX = maxAbsX > 1e-12 ? maxAbsX : 1;
      scaleY = maxAbsY > 1e-12 ? maxAbsY : 1;
      scaleZ = maxAbsZ > 1e-12 ? maxAbsZ : 1;
      scaleMagnitude = maxMag > 1e-12 ? maxMag : 1;
    }
    for (let i = 0; i < nNodes; i++) {
      if (!fld || field === "none") {
        _c.setHSL(0, 0, 0.6);
      } else {
        const fx = fld.x[i] ?? 0, fy = fld.y[i] ?? 0, fz = fld.z[i] ?? 0;
        switch (field) {
          case "orientation": applyMagnetizationHsl(fx, fy, fz, _c); break;
          case "x": divergingColor(fx / scaleX, _c); break;
          case "y": divergingColor(fy / scaleY, _c); break;
          case "z": divergingColor(fz / scaleZ, _c); break;
          case "magnitude": magnitudeColor(Math.sqrt(fx * fx + fy * fy + fz * fz) / scaleMagnitude, _c); break;
        }
      }
      colors[i * 3] = _c.r; colors[i * 3 + 1] = _c.g; colors[i * 3 + 2] = _c.b;
    }
  }
  return colors;
}

export function FemGeometry({
  meshData,
  field,
  renderMode,
  opacity,
  qualityPerFace,
  onGeometryCenter,
  onFaceClick,
  onFaceHover,
  onFaceUnhover,
  onFaceContextMenu,
}: FemGeometryProps) {
  const { invalidate } = useThree();

  // ── Topology memo: only rebuilds when mesh structure changes ─────
  const topologySignature = `${meshData.nNodes}:${meshData.nElements}:${meshData.boundaryFaces.length}`;

  const { geometry, edgesGeometry, center, maxDim, geoSize } = useMemo(() => {
    const { nodes, boundaryFaces, nNodes } = meshData;
    const positions = new Float32Array(nNodes * 3);
    for (let i = 0; i < nNodes * 3; i++) positions[i] = nodes[i];

    const nFaces = boundaryFaces.length / 3;
    const indices = new Uint32Array(nFaces * 3);
    for (let i = 0; i < nFaces * 3; i++) indices[i] = boundaryFaces[i];

    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geom.setIndex(new THREE.BufferAttribute(indices, 1));
    geom.computeVertexNormals();

    // Placeholder color attribute (will be updated by color effect)
    geom.setAttribute("color", new THREE.BufferAttribute(new Float32Array(nNodes * 3), 3));

    geom.computeBoundingBox();
    const bb = geom.boundingBox!;
    const c = new THREE.Vector3();
    bb.getCenter(c);
    const size = new THREE.Vector3();
    bb.getSize(size);
    const ms = Math.max(size.x, size.y, size.z);
    geom.translate(-c.x, -c.y, -c.z);

    const edgesGeom = new THREE.WireframeGeometry(geom);

    invalidate();
    return { geometry: geom, edgesGeometry: edgesGeom, center: c, maxDim: ms, geoSize: size };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topologySignature, invalidate]);

  // ── Color update: only recomputes vertex colors, reuses geometry ─
  useEffect(() => {
    if (!geometry) return;
    const colors = computeVertexColors(
      meshData.nNodes, field, meshData.fieldData,
      meshData.nodes, meshData.boundaryFaces, qualityPerFace,
    );
    const colorAttr = geometry.getAttribute("color") as THREE.BufferAttribute;
    colorAttr.set(colors);
    colorAttr.needsUpdate = true;
    invalidate();
  }, [geometry, meshData.fieldData, field, qualityPerFace, meshData.nNodes, meshData.nodes, meshData.boundaryFaces, invalidate]);

  // ── Notify parent about geometry center (proper useEffect, not useMemo side-effect) ─
  const onGeometryCenterRef = useRef(onGeometryCenter);
  onGeometryCenterRef.current = onGeometryCenter;
  useEffect(() => {
    if (maxDim > 0 && onGeometryCenterRef.current) {
      onGeometryCenterRef.current(center, maxDim, geoSize);
    }
  }, [center, maxDim, geoSize]);

  // ── Dispose old THREE geometries to prevent GPU memory leaks ─────
  const prevGeomsRef = useRef<{ g: THREE.BufferGeometry | null; e: THREE.BufferGeometry | null }>({ g: null, e: null });
  useEffect(() => {
    if (prevGeomsRef.current.g && prevGeomsRef.current.g !== geometry) {
      prevGeomsRef.current.g.dispose();
    }
    if (prevGeomsRef.current.e && prevGeomsRef.current.e !== edgesGeometry) {
      prevGeomsRef.current.e.dispose();
    }
    prevGeomsRef.current = { g: geometry, e: edgesGeometry };
    return () => {
      geometry?.dispose();
      edgesGeometry?.dispose();
    };
  }, [geometry, edgesGeometry]);

  const showSurface = renderMode === "surface" || renderMode === "surface+edges" || renderMode === "wireframe";
  const showWire = renderMode === "surface+edges";
  const isWireframeMaterial = renderMode === "wireframe";
  const showPoints = renderMode === "points";

  const isTransparent = opacity < 100;
  const opacityVal = opacity / 100;

  return (
    <group>
      {showSurface && (
        <mesh 
          geometry={geometry}
          onClick={onFaceClick}
          onPointerOver={onFaceHover}
          onPointerOut={onFaceUnhover}
          onContextMenu={onFaceContextMenu}
        >
          <meshPhongMaterial
            vertexColors
            side={THREE.DoubleSide}
            flatShading={false}
            shininess={40}
            transparent={isTransparent}
            opacity={opacityVal}
            depthWrite={!isTransparent}
            wireframe={isWireframeMaterial}
          />
        </mesh>
      )}
      
      {showWire && (
        <lineSegments geometry={edgesGeometry}>
          <lineBasicMaterial color={0x9bb7d4} opacity={0.5} transparent />
        </lineSegments>
      )}

      {showPoints && (
        <points geometry={geometry}>
          <pointsMaterial 
            vertexColors 
            size={maxDim * 0.008} 
            sizeAttenuation 
            transparent={isTransparent}
            opacity={opacityVal} 
          />
        </points>
      )}
    </group>
  );
}
