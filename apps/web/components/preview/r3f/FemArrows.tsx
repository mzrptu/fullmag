import React, { useMemo, useRef, useEffect, useLayoutEffect } from "react";
import * as THREE from "three";
import { useThree } from "@react-three/fiber";
import { FemMeshData, FemColorField } from "../FemMeshView3D";
import { divergingColor, magnitudeColor } from "./colorUtils";
import { applyMagnetizationHsl } from "../magnetizationColor";
import { RENDER_POLICIES_V2 } from "../shared/renderPolicyV2";

export type ArrowLengthMode = "constant" | "magnitude" | "sqrt" | "log";

interface FemArrowsProps {
  meshData: FemMeshData;
  field: FemColorField;
  arrowDensity: number;
  center: THREE.Vector3;
  maxDim: number;
  visible: boolean;
  activeNodeMask?: boolean[] | null;
  boundaryFaceIndices?: number[] | null;
  lengthMode?: ArrowLengthMode;
}

/* ── Arrow template geometry — only depends on maxDim ───────────────── */
function useArrowTemplate(maxDim: number) {
  const templateRef = useRef<THREE.BufferGeometry | null>(null);

  return useMemo(() => {
    templateRef.current?.dispose();

    const arrowLen = maxDim * 0.035;
    const shaftRadius = arrowLen * 0.08;
    const headRadius = arrowLen * 0.20;
    const headLen = arrowLen * 0.35;
    const shaftLen = arrowLen - headLen;

    const shaft = new THREE.CylinderGeometry(shaftRadius, shaftRadius, shaftLen, 6);
    shaft.rotateX(Math.PI / 2);
    // Position base of shaft exactly at Z=0
    shaft.translate(0, 0, shaftLen / 2);
    
    const head = new THREE.ConeGeometry(headRadius, headLen, 6);
    head.rotateX(Math.PI / 2);
    // Position head precisely at the end of the shaft
    head.translate(0, 0, shaftLen + headLen / 2);

    const shaftPos = shaft.getAttribute("position") as THREE.BufferAttribute;
    const headPos = head.getAttribute("position") as THREE.BufferAttribute;
    const totalVerts = shaftPos.count + headPos.count;
    const positions = new Float32Array(totalVerts * 3);
    const normals = new Float32Array(totalVerts * 3);
    positions.set(new Float32Array(shaftPos.array), 0);
    positions.set(new Float32Array(headPos.array), shaftPos.count * 3);
    const shaftNorm = shaft.getAttribute("normal") as THREE.BufferAttribute;
    const headNorm = head.getAttribute("normal") as THREE.BufferAttribute;
    normals.set(new Float32Array(shaftNorm.array), 0);
    normals.set(new Float32Array(headNorm.array), shaftPos.count * 3);

    const merged = new THREE.BufferGeometry();
    merged.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    merged.setAttribute("normal", new THREE.BufferAttribute(normals, 3));

    const shaftIdx = shaft.getIndex()!;
    const headIdx = head.getIndex()!;
    const indexArr = new Uint32Array(shaftIdx.count + headIdx.count);
    for (let i = 0; i < shaftIdx.count; i++) indexArr[i] = shaftIdx.array[i];
    for (let i = 0; i < headIdx.count; i++) indexArr[shaftIdx.count + i] = headIdx.array[i] + shaftPos.count;
    merged.setIndex(new THREE.BufferAttribute(indexArr, 1));

    shaft.dispose();
    head.dispose();

    templateRef.current = merged;
    return merged;
  }, [maxDim]);
}

/* ── Sample boundary nodes adaptively ───────────────────────────────── */
function sampleCandidateNodes(
  nodes: number[], 
  candidateNodes: readonly number[],
  targetDensity: number,
  fld?: { x: number[], y: number[], z: number[] }
): number[] {
  const allBoundaryNodes = Array.from(new Set(candidateNodes));

  if (allBoundaryNodes.length <= targetDensity) return allBoundaryNodes;

  let bMinX = Infinity, bMinY = Infinity, bMinZ = Infinity;
  let bMaxX = -Infinity, bMaxY = -Infinity, bMaxZ = -Infinity;
  for (const ni of allBoundaryNodes) {
    const x = nodes[ni * 3], y = nodes[ni * 3 + 1], z = nodes[ni * 3 + 2];
    bMinX = Math.min(bMinX, x); bMaxX = Math.max(bMaxX, x);
    bMinY = Math.min(bMinY, y); bMaxY = Math.max(bMaxY, y);
    bMinZ = Math.min(bMinZ, z); bMaxZ = Math.max(bMaxZ, z);
  }
  
  const volume = Math.max(1e-30, (bMaxX - bMinX) * (bMaxY - bMinY) * (bMaxZ - bMinZ));
  // Oversample to create a large candidate pool
  const nCandidateCells = targetDensity * 4;
  const cellSize = Math.pow(volume / nCandidateCells, 1 / 3);
  const invCell = 1 / Math.max(cellSize, 1e-30);
  const nBinsX = Math.max(1, Math.ceil((bMaxX - bMinX) * invCell));
  const nBinsY = Math.max(1, Math.ceil((bMaxY - bMinY) * invCell));

  const cellMap = new Map<number, { 
    cx: number, cy: number, cz: number, 
    bestDistSq: number, bestNi: number, 
    sumX: number, sumY: number, sumZ: number, count: number 
  }>();

  for (const ni of allBoundaryNodes) {
    const x = nodes[ni * 3], y = nodes[ni * 3 + 1], z = nodes[ni * 3 + 2];
    const ix = Math.min(nBinsX - 1, Math.floor((x - bMinX) * invCell));
    const iy = Math.min(nBinsY - 1, Math.floor((y - bMinY) * invCell));
    const iz = Math.floor((z - bMinZ) * invCell);
    const key = ix + iy * nBinsX + iz * nBinsX * nBinsY;

    let cell = cellMap.get(key);
    if (!cell) {
      cell = {
        cx: bMinX + (ix + 0.5) * cellSize, cy: bMinY + (iy + 0.5) * cellSize, cz: bMinZ + (iz + 0.5) * cellSize,
        bestDistSq: Infinity, bestNi: -1, sumX: 0, sumY: 0, sumZ: 0, count: 0
      };
      cellMap.set(key, cell);
    }
    
    // Pick node closest to cell center to eliminate random visual jitter
    const dx = x - cell.cx, dy = y - cell.cy, dz = z - cell.cz;
    const distSq = dx*dx + dy*dy + dz*dz;
    if (distSq < cell.bestDistSq) {
      cell.bestDistSq = distSq;
      cell.bestNi = ni;
    }

    if (fld) {
      let vx = fld.x[ni] ?? 0, vy = fld.y[ni] ?? 0, vz = fld.z[ni] ?? 0;
      const len = Math.sqrt(vx*vx + vy*vy + vz*vz);
      if (len > 1e-12) { vx /= len; vy /= len; vz /= len; }
      cell.sumX += vx; cell.sumY += vy; cell.sumZ += vz;
    }
    cell.count++;
  }

  interface Candidate { ni: number; score: number; hash: number; }
  const candidates: Candidate[] = [];
  
  // Deterministic noise for sub-grid distribution
  const hashFn = (k: number) => { let x = Math.sin(k * 12.9898) * 43758.5453; return x - Math.floor(x); };

  for (const [key, cell] of cellMap.entries()) {
    let score = 0;
    if (cell.count > 0 && fld) {
      // alignment = length of sum of unit vectors / count
      const avgLen = Math.sqrt(cell.sumX * cell.sumX + cell.sumY * cell.sumY + cell.sumZ * cell.sumZ);
      // High score = low alignment (domain wall)
      score = 1.0 - (avgLen / cell.count); 
    }
    candidates.push({ ni: cell.bestNi, score, hash: hashFn(key) });
  }

  if (candidates.length <= targetDensity) return candidates.map((c) => c.ni);

  // 1. Allocate 20% of the target density to random spatial cells for a uniform baseline
  candidates.sort((a, b) => a.hash - b.hash);
  const result: number[] = [];
  const baseQuota = Math.floor(targetDensity * 0.2);
  for (let i = 0; i < baseQuota; i++) {
    if (i < candidates.length) {
      result.push(candidates[i].ni);
      candidates[i].score = -1; // Mark used
    }
  }
  
  // 2. Allocate remaining 80% to cells with the highest field variance
  candidates.sort((a, b) => b.score - a.score);
  let added = 0;
  for (let i = 0; i < candidates.length && added < (targetDensity - baseQuota); i++) {
    if (candidates[i].score !== -1) {
      result.push(candidates[i].ni);
      added++;
    }
  }
  
  return result;
}

export function FemArrows({
  meshData,
  field,
  arrowDensity,
  center,
  maxDim,
  visible,
  activeNodeMask,
  boundaryFaceIndices,
  lengthMode = "magnitude",
}: FemArrowsProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const { invalidate } = useThree();
  const glyphPolicy = RENDER_POLICIES_V2.glyphs;
  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: "#ffffff",
        vertexColors: true,
        transparent: glyphPolicy.transparent,
        depthWrite: glyphPolicy.depthWrite,
        depthTest: glyphPolicy.depthTest,
        side: glyphPolicy.side,
        toneMapped: false,
      }),
    [glyphPolicy.depthTest, glyphPolicy.depthWrite, glyphPolicy.side, glyphPolicy.transparent],
  );

  // Template geometry — only rebuilt when maxDim changes
  const templateGeometry = useArrowTemplate(maxDim);

  useEffect(() => {
    return () => {
      material.dispose();
    };
  }, [material]);

  // Instance data (positions, rotations, colors) — depends on field data
  const { count, instancePositions, quaternions, scales, colors } = useMemo(() => {
    const emptyRet = { count: 0, instancePositions: [] as number[][], quaternions: new Float32Array(), scales: new Float32Array(), colors: new Float32Array() };
    if (!visible) return emptyRet;
    const fld = meshData.fieldData;
    if (!fld) return emptyRet;
    const effectiveNodeMask =
      activeNodeMask && activeNodeMask.length === meshData.nNodes
        ? activeNodeMask
        : meshData.quantityDomain === "magnetic_only" &&
            meshData.activeMask &&
            meshData.activeMask.length === meshData.nNodes
          ? meshData.activeMask
          : null;
    if (meshData.quantityDomain === "magnetic_only" && !effectiveNodeMask) {
      return emptyRet;
    }

    const boundaryCandidateNodes = (() => {
      const unique = new Set<number>();
      if (boundaryFaceIndices && boundaryFaceIndices.length > 0) {
        for (const faceIndex of boundaryFaceIndices) {
          const base = faceIndex * 3;
          if (base + 2 >= meshData.boundaryFaces.length) {
            continue;
          }
          unique.add(meshData.boundaryFaces[base]);
          unique.add(meshData.boundaryFaces[base + 1]);
          unique.add(meshData.boundaryFaces[base + 2]);
        }
      } else {
        for (let i = 0; i < meshData.boundaryFaces.length; i += 1) {
          unique.add(meshData.boundaryFaces[i]);
        }
      }
      return Array.from(unique);
    })();
    const maskedCandidateNodes =
      effectiveNodeMask
        ? effectiveNodeMask
            .map((active, nodeIndex) => (active ? nodeIndex : -1))
            .filter((nodeIndex) => nodeIndex >= 0)
        : null;
    const sampledNodes = sampleCandidateNodes(
      meshData.nodes,
      maskedCandidateNodes && maskedCandidateNodes.length > 0
        ? maskedCandidateNodes
        : boundaryCandidateNodes,
      arrowDensity,
      fld,
    );
    const resultCount = sampledNodes.length;

    let maxAbsX = 0, maxAbsY = 0, maxAbsZ = 0, maxMag = 0;
    for (const ni of sampledNodes) {
      const vx = fld.x[ni] ?? 0, vy = fld.y[ni] ?? 0, vz = fld.z[ni] ?? 0;
      maxAbsX = Math.max(maxAbsX, Math.abs(vx));
      maxAbsY = Math.max(maxAbsY, Math.abs(vy));
      maxAbsZ = Math.max(maxAbsZ, Math.abs(vz));
      maxMag = Math.max(maxMag, Math.sqrt(vx * vx + vy * vy + vz * vz));
    }
    const scaleX = Math.max(maxAbsX, 1e-12);
    const scaleY = Math.max(maxAbsY, 1e-12);
    const scaleZ = Math.max(maxAbsZ, 1e-12);
    const scaleMag = Math.max(maxMag, 1e-12);

    const quaternionsList = new Float32Array(resultCount * 4);
    const scalesList = new Float32Array(resultCount * 3);
    const colorsList = new Float32Array(resultCount * 3);
    const positions: number[][] = [];

    const _dir = new THREE.Vector3();
    const _defaultUp = new THREE.Vector3(0, 0, 1);
    const _color = new THREE.Color();
    const _dummyQ = new THREE.Quaternion();

    for (let i = 0; i < resultCount; i++) {
      const ni = sampledNodes[i];
      positions.push([
        meshData.nodes[ni * 3] - center.x,
        meshData.nodes[ni * 3 + 1] - center.y,
        meshData.nodes[ni * 3 + 2] - center.z,
      ]);
      const vx = fld.x[ni] ?? 0, vy = fld.y[ni] ?? 0, vz = fld.z[ni] ?? 0;
      const len = Math.sqrt(vx * vx + vy * vy + vz * vz);

      if (len < 1e-12) {
        scalesList[i * 3] = 0; scalesList[i * 3 + 1] = 0; scalesList[i * 3 + 2] = 0;
        _dummyQ.identity();
      } else {
        // Compute length scale based on mode
        let s = 1;
        if (lengthMode === "magnitude") {
          s = 0.2 + 0.8 * (len / scaleMag);
        } else if (lengthMode === "sqrt") {
          s = 0.2 + 0.8 * Math.sqrt(len / scaleMag);
        } else if (lengthMode === "log") {
          s = 0.2 + 0.8 * Math.log1p(len / scaleMag * 9) / Math.log(10);
        }
        // constant: s stays 1
        scalesList[i * 3] = s; scalesList[i * 3 + 1] = s; scalesList[i * 3 + 2] = s;
        _dir.set(vx, vy, vz).normalize();
        _dummyQ.setFromUnitVectors(_defaultUp, _dir);
      }

      quaternionsList[i * 4] = _dummyQ.x;
      quaternionsList[i * 4 + 1] = _dummyQ.y;
      quaternionsList[i * 4 + 2] = _dummyQ.z;
      quaternionsList[i * 4 + 3] = _dummyQ.w;

      switch (field) {
        case "orientation": applyMagnetizationHsl(vx, vy, vz, _color); break;
        case "x": divergingColor(vx / scaleX, _color); break;
        case "y": divergingColor(vy / scaleY, _color); break;
        case "z": divergingColor(vz / scaleZ, _color); break;
        case "magnitude": magnitudeColor(len / scaleMag, _color); break;
        default: applyMagnetizationHsl(vx, vy, vz, _color); break;
      }

      colorsList[i * 3] = _color.r;
      colorsList[i * 3 + 1] = _color.g;
      colorsList[i * 3 + 2] = _color.b;
    }

    return { count: resultCount, instancePositions: positions, quaternions: quaternionsList, scales: scalesList, colors: colorsList };
  }, [meshData, field, arrowDensity, center, visible, lengthMode, activeNodeMask, boundaryFaceIndices]);
  const capacity = Math.max(count, 1);
  const instanceColorAttribute = useMemo(() => {
    const attribute = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    attribute.setUsage(THREE.DynamicDrawUsage);
    return attribute;
  }, [capacity]);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) {
      return;
    }
    mesh.instanceColor = instanceColorAttribute;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.renderOrder = glyphPolicy.renderOrder;
    mesh.count = count;
    mesh.instanceColor.needsUpdate = true;
    material.needsUpdate = true;
    invalidate();
  }, [count, glyphPolicy.renderOrder, instanceColorAttribute, invalidate, material]);

  // Apply instance matrices and per-instance colors using the same low-level
  // buffer path that already works reliably in FDM preview rendering.
  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;

    const instanceColor = mesh.instanceColor ?? instanceColorAttribute;
    if (!instanceColor) return;
    const colorArray = instanceColor.array as Float32Array;
    const matrixArray = mesh.instanceMatrix.array as Float32Array;

    const dummy = new THREE.Object3D();
    let matrixOffset = 0;
    let colorOffset = 0;

    for (let i = 0; i < count; i += 1) {
      dummy.position.set(
        instancePositions[i][0],
        instancePositions[i][1],
        instancePositions[i][2],
      );
      dummy.quaternion.set(
        quaternions[i * 4],
        quaternions[i * 4 + 1],
        quaternions[i * 4 + 2],
        quaternions[i * 4 + 3],
      );
      dummy.scale.set(scales[i * 3], scales[i * 3 + 1], scales[i * 3 + 2]);
      dummy.updateMatrix();
      dummy.matrix.toArray(matrixArray, matrixOffset);
      matrixOffset += 16;

      colorArray[colorOffset] = colors[i * 3];
      colorArray[colorOffset + 1] = colors[i * 3 + 1];
      colorArray[colorOffset + 2] = colors[i * 3 + 2];
      colorOffset += 3;
    }

    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
    instanceColor.needsUpdate = true;
    material.needsUpdate = true;
    invalidate();
  }, [
    colors,
    count,
    instanceColorAttribute,
    instancePositions,
    invalidate,
    material,
    quaternions,
    scales,
  ]);

  if (!visible || count === 0) return null;

  return (
    <instancedMesh
      ref={meshRef}
      args={[templateGeometry!, material, capacity]}
      frustumCulled={false}
      renderOrder={glyphPolicy.renderOrder}
    >
      <primitive attach="instanceColor" object={instanceColorAttribute} />
    </instancedMesh>
  );
}
