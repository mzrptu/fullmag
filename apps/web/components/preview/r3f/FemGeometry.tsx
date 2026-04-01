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
  shrinkFactor?: number;
  clipEnabled?: boolean;
  clipAxis?: "x" | "y" | "z";
  clipPos?: number;
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
  } else if (field === "sicn" && qualityPerFace && qualityPerFace.length === nFaces) {
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
  } else if (field === "sicn") {
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
  shrinkFactor,
  clipEnabled,
  clipAxis,
  clipPos,
  onGeometryCenter,
  onFaceClick,
  onFaceHover,
  onFaceUnhover,
  onFaceContextMenu,
}: FemGeometryProps) {
  const { invalidate } = useThree();

  // ── Topology memo: only rebuilds when mesh structure changes ─────
  const topologySignature = `${meshData.nNodes}:${meshData.nElements}:${meshData.boundaryFaces.length}:${shrinkFactor ?? 1}:${clipEnabled ? `${clipAxis}${clipPos}` : "noclip"}`;

  const { geometry, edgesGeometry, tetraEdgesGeometry, center, maxDim, geoSize, vertexMap } = useMemo(() => {
    const { nodes, elements, boundaryFaces, nNodes } = meshData;
    const positions = new Float32Array(nNodes * 3);
    for (let i = 0; i < nNodes * 3; i++) positions[i] = nodes[i];

    // Compute unclipped bounding box for stable centering
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < nNodes * 3; i += 3) {
      const x = positions[i], y = positions[i + 1], z = positions[i + 2];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    const cX = (minX + maxX) / 2, cY = (minY + maxY) / 2, cZ = (minZ + maxZ) / 2;
    const size = new THREE.Vector3(maxX - minX, maxY - minY, maxZ - minZ);
    const ms = Math.max(size.x, size.y, size.z);
    
    // Center positions
    for (let i = 0; i < nNodes * 3; i += 3) {
      positions[i] -= cX; positions[i + 1] -= cY; positions[i + 2] -= cZ;
    }

    const isVolumetric = elements.length >= 4;
    const doVolumeClip = isVolumetric && clipEnabled;
    const doShrink = isVolumetric && shrinkFactor && shrinkFactor < 0.999;

    let finalIndices: Uint32Array | null = null;
    let finalPositions: Float32Array = positions;
    let vMap: Int32Array | null = null;
    const tetraEdgePairs: number[] = [];

    const getAxisIdx = () => clipAxis === "y" ? 1 : clipAxis === "z" ? 2 : 0;
    const clipAxisSize = clipAxis === "y" ? size.y : clipAxis === "z" ? size.z : size.x;
    const posReal = ((clipPos ?? 50) / 100 - 0.5) * clipAxisSize;

    if (doShrink) {
      const keptTets: number[] = [];
      const axisIdx = getAxisIdx();
      for (let i = 0; i < elements.length; i += 4) {
        if (clipEnabled) {
          const cx = (positions[elements[i]*3+axisIdx] + positions[elements[i+1]*3+axisIdx] + positions[elements[i+2]*3+axisIdx] + positions[elements[i+3]*3+axisIdx]) / 4;
          if (cx > posReal) continue;
        }
        keptTets.push(elements[i], elements[i+1], elements[i+2], elements[i+3]);
      }

      finalPositions = new Float32Array(keptTets.length / 4 * 12 * 3);
      vMap = new Int32Array(keptTets.length / 4 * 12);
      
      const faces = [[0,1,3], [1,2,3], [2,0,3], [0,2,1]]; // tet faces
      let vIdx = 0;
      const sf = shrinkFactor ?? 1.0;
      
      for (let i = 0; i < keptTets.length; i += 4) {
        const tet = [keptTets[i], keptTets[i+1], keptTets[i+2], keptTets[i+3]];
        const cx = (positions[tet[0]*3] + positions[tet[1]*3] + positions[tet[2]*3] + positions[tet[3]*3]) / 4;
        const cy = (positions[tet[0]*3+1] + positions[tet[1]*3+1] + positions[tet[2]*3+1] + positions[tet[3]*3+1]) / 4;
        const cz = (positions[tet[0]*3+2] + positions[tet[1]*3+2] + positions[tet[2]*3+2] + positions[tet[3]*3+2]) / 4;
        
        for (const face of faces) {
          for (const fv of face) {
            const origNode = tet[fv];
            vMap[vIdx] = origNode;
            const px = positions[origNode*3];
            const py = positions[origNode*3+1];
            const pz = positions[origNode*3+2];
            finalPositions[vIdx*3] = cx + (px - cx) * sf;
            finalPositions[vIdx*3+1] = cy + (py - cy) * sf;
            finalPositions[vIdx*3+2] = cz + (pz - cz) * sf;
            vIdx++;
          }
        }
      }
    } else if (doVolumeClip) {
      const faceMap = new Map<bigint, [number, number, number]>();
      const addFace = (a: number, b: number, c: number) => {
        let v1 = a, v2 = b, v3 = c;
        if (v2 < v1 && v2 < v3) { v1 = b; v2 = c; v3 = a; }
        else if (v3 < v1 && v3 < v2) { v1 = c; v2 = a; v3 = b; }
        const key = BigInt(v1) | (BigInt(Math.min(v2, v3)) << 20n) | (BigInt(Math.max(v2, v3)) << 40n);
        if (faceMap.has(key)) faceMap.delete(key);
        else faceMap.set(key, [a, b, c]);
      };

      const axisIdx = getAxisIdx();
      for (let i = 0; i < elements.length; i += 4) {
        const a = elements[i], b = elements[i+1], cIdx = elements[i+2], d = elements[i+3];
        const cx = (positions[a*3+axisIdx] + positions[b*3+axisIdx] + positions[cIdx*3+axisIdx] + positions[d*3+axisIdx]) / 4;
        if (cx > posReal) continue; // clipped
        addFace(a, b, d);
        addFace(b, cIdx, d);
        addFace(cIdx, a, d);
        addFace(a, cIdx, b);
      }
      finalIndices = new Uint32Array(faceMap.size * 3);
      let idx = 0;
      for (const face of faceMap.values()) {
        finalIndices[idx++] = face[0];
        finalIndices[idx++] = face[1];
        finalIndices[idx++] = face[2];
      }
    } else {
      const nFaces = boundaryFaces.length / 3;
      finalIndices = new Uint32Array(nFaces * 3);
      for (let i = 0; i < nFaces * 3; i++) finalIndices[i] = boundaryFaces[i];
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(finalPositions, 3));
    if (finalIndices) {
      geom.setIndex(new THREE.BufferAttribute(finalIndices, 1));
    }
    geom.computeVertexNormals();
    geom.setAttribute("color", new THREE.BufferAttribute(new Float32Array(finalPositions.length), 3));

    // For wireframe, compute it from the `geom` (which represents the exact visible cut shell or shrunken elements)
    const edgesGeom = new THREE.WireframeGeometry(geom);

    if (elements.length >= 4) {
      const seenEdges = new Set<string>();
      const registerEdge = (a: number, b: number) => {
        const lo = Math.min(a, b);
        const hi = Math.max(a, b);
        const key = `${lo}:${hi}`;
        if (seenEdges.has(key)) return;
        seenEdges.add(key);
        tetraEdgePairs.push(lo, hi);
      };
      for (let i = 0; i < elements.length; i += 4) {
        const a = elements[i];
        const b = elements[i + 1];
        const cIdx = elements[i + 2];
        const d = elements[i + 3];
        registerEdge(a, b);
        registerEdge(a, cIdx);
        registerEdge(a, d);
        registerEdge(b, cIdx);
        registerEdge(b, d);
        registerEdge(cIdx, d);
      }
    }

    let tetraWireGeom: THREE.BufferGeometry | null = null;
    if (tetraEdgePairs.length > 0 && !doShrink) {
      tetraWireGeom = new THREE.BufferGeometry();
      tetraWireGeom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      tetraWireGeom.setIndex(new THREE.BufferAttribute(new Uint32Array(tetraEdgePairs), 1));
    }

    invalidate();
    return {
      geometry: geom,
      edgesGeometry: edgesGeom,
      tetraEdgesGeometry: tetraWireGeom,
      center: new THREE.Vector3(cX, cY, cZ),
      maxDim: ms,
      geoSize: size,
      vertexMap: vMap,
    };
  }, [topologySignature, clipAxis, clipEnabled, clipPos, shrinkFactor, invalidate]);

  // ── Color update ──────────────────────────────────────────────────
  useEffect(() => {
    if (!geometry) return;
    const baseColors = computeVertexColors(
      meshData.nNodes, field, meshData.fieldData,
      meshData.nodes, meshData.boundaryFaces, qualityPerFace,
    );
    
    // Sub-select or map colors
    const colorAttr = geometry.getAttribute("color") as THREE.BufferAttribute;
    if (vertexMap) {
      for (let i = 0; i < vertexMap.length; i++) {
        const orig = vertexMap[i];
        colorAttr.array[i*3] = baseColors[orig*3];
        colorAttr.array[i*3+1] = baseColors[orig*3+1];
        colorAttr.array[i*3+2] = baseColors[orig*3+2];
      }
    } else {
      const posCount = geometry.getAttribute("position").count;
      for (let i = 0; i < posCount * 3; i++) {
        colorAttr.array[i] = baseColors[i];
      }
    }
    colorAttr.needsUpdate = true;
    invalidate();
  }, [geometry, vertexMap, meshData.fieldData, field, qualityPerFace, meshData.nNodes, invalidate]);

  // ── Notify parent about geometry center (proper useEffect, not useMemo side-effect) ─
  const onGeometryCenterRef = useRef(onGeometryCenter);
  onGeometryCenterRef.current = onGeometryCenter;
  useEffect(() => {
    if (maxDim > 0 && onGeometryCenterRef.current) {
      onGeometryCenterRef.current(center, maxDim, geoSize);
    }
  }, [center, maxDim, geoSize]);

  // ── Dispose old THREE geometries to prevent GPU memory leaks ─────
  const prevGeomsRef = useRef<{
    g: THREE.BufferGeometry | null;
    e: THREE.BufferGeometry | null;
    t: THREE.BufferGeometry | null;
  }>({ g: null, e: null, t: null });
  useEffect(() => {
    if (prevGeomsRef.current.g && prevGeomsRef.current.g !== geometry) {
      prevGeomsRef.current.g.dispose();
    }
    if (prevGeomsRef.current.e && prevGeomsRef.current.e !== edgesGeometry) {
      prevGeomsRef.current.e.dispose();
    }
    if (prevGeomsRef.current.t && prevGeomsRef.current.t !== tetraEdgesGeometry) {
      prevGeomsRef.current.t.dispose();
    }
    prevGeomsRef.current = { g: geometry, e: edgesGeometry, t: tetraEdgesGeometry };
    return () => {
      geometry?.dispose();
      edgesGeometry?.dispose();
      tetraEdgesGeometry?.dispose();
    };
  }, [geometry, edgesGeometry, tetraEdgesGeometry]);

  const showSurface = renderMode === "surface" || renderMode === "surface+edges";
  const showWire = renderMode === "surface+edges";
  const showVolumeWire = renderMode === "wireframe";
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
            side={isTransparent ? THREE.DoubleSide : THREE.FrontSide}
            flatShading={false}
            shininess={40}
            transparent={isTransparent}
            opacity={opacityVal}
            depthWrite={!isTransparent}
          />
        </mesh>
      )}
      
      {showWire && (
        <lineSegments geometry={edgesGeometry}>
          <lineBasicMaterial color={0x9bb7d4} opacity={0.5} transparent />
        </lineSegments>
      )}

      {showVolumeWire && (tetraEdgesGeometry ?? edgesGeometry) && (
        <lineSegments geometry={tetraEdgesGeometry ?? edgesGeometry}>
          <lineBasicMaterial color={0xdbeafe} opacity={0.28} transparent />
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
