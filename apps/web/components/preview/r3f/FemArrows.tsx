import React, { useMemo, useRef, useEffect } from "react";
import * as THREE from "three";
import { useThree } from "@react-three/fiber";
import { FemMeshData, FemColorField } from "../FemMeshView3D";
import { divergingColor, magnitudeColor } from "./colorUtils";
import { applyMagnetizationHsl } from "../magnetizationColor";

interface FemArrowsProps {
  meshData: FemMeshData;
  field: FemColorField;
  arrowDensity: number;
  center: THREE.Vector3;
  maxDim: number;
  visible: boolean;
}

export function FemArrows({ meshData, field, arrowDensity, center, maxDim, visible }: FemArrowsProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const { invalidate } = useThree();

  const { mergedGeometry, scales, quaternions, colors, count, positions } = useMemo(() => {
    const emptyRet = { count: 0, mergedGeometry: null, scales: new Float32Array(), quaternions: new Float32Array(), colors: new Float32Array(), positions: [] };
    if (!visible) return emptyRet;
    const fld = meshData.fieldData;
    if (!fld) return emptyRet;

    const { nodes, boundaryFaces } = meshData;
    
    // 1. Unique boundary nodes
    const uniqueNodeSet = new Set<number>();
    for (let i = 0; i < boundaryFaces.length; i++) uniqueNodeSet.add(boundaryFaces[i]);
    const allBoundaryNodes = Array.from(uniqueNodeSet);

    let sampledNodes: number[];
    if (allBoundaryNodes.length <= arrowDensity) {
      sampledNodes = allBoundaryNodes;
    } else {
      let bMinX = Infinity, bMinY = Infinity, bMinZ = Infinity;
      let bMaxX = -Infinity, bMaxY = -Infinity, bMaxZ = -Infinity;
      for (const ni of allBoundaryNodes) {
        const x = nodes[ni * 3], y = nodes[ni * 3 + 1], z = nodes[ni * 3 + 2];
        bMinX = Math.min(bMinX, x); bMaxX = Math.max(bMaxX, x);
        bMinY = Math.min(bMinY, y); bMaxY = Math.max(bMaxY, y);
        bMinZ = Math.min(bMinZ, z); bMaxZ = Math.max(bMaxZ, z);
      }
      const volume = Math.max(1e-30, (bMaxX - bMinX) * (bMaxY - bMinY) * (bMaxZ - bMinZ));
      const cellSize = Math.pow(volume / arrowDensity, 1 / 3);
      const invCell = 1 / Math.max(cellSize, 1e-30);
      const nBinsX = Math.max(1, Math.ceil((bMaxX - bMinX) * invCell));
      const nBinsY = Math.max(1, Math.ceil((bMaxY - bMinY) * invCell));
      const nBinsZ = Math.max(1, Math.ceil((bMaxZ - bMinZ) * invCell));

      const occupied = new Map<number, number>();
      for (const ni of allBoundaryNodes) {
        const ix = Math.min(nBinsX - 1, Math.floor((nodes[ni * 3] - bMinX) * invCell));
        const iy = Math.min(nBinsY - 1, Math.floor((nodes[ni * 3 + 1] - bMinY) * invCell));
        const iz = Math.min(nBinsZ - 1, Math.floor((nodes[ni * 3 + 2] - bMinZ) * invCell));
        const key = ix + iy * nBinsX + iz * nBinsX * nBinsY;
        if (!occupied.has(key)) occupied.set(key, ni);
      }
      sampledNodes = Array.from(occupied.values());
    }

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

    const arrowLen = maxDim * 0.035;
    const shaftRadius = arrowLen * 0.08;
    const headRadius = arrowLen * 0.20;
    const headLen = arrowLen * 0.35;
    const shaftLen = arrowLen - headLen;
    const shaft = new THREE.CylinderGeometry(shaftRadius, shaftRadius, shaftLen, 6);
    shaft.rotateX(Math.PI / 2);
    shaft.translate(0, 0, shaftLen / 2);
    const head = new THREE.ConeGeometry(headRadius, headLen, 6);
    head.rotateX(Math.PI / 2);
    head.translate(0, 0, shaftLen + headLen / 2);

    const mergedGeometry = new THREE.BufferGeometry();
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
    mergedGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    mergedGeometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
    const shaftIdx = shaft.getIndex()!;
    const headIdx = head.getIndex()!;
    const totalIdx = shaftIdx.count + headIdx.count;
    const indexArr = new Uint32Array(totalIdx);
    for (let i = 0; i < shaftIdx.count; i++) indexArr[i] = shaftIdx.array[i];
    for (let i = 0; i < headIdx.count; i++) indexArr[shaftIdx.count + i] = headIdx.array[i] + shaftPos.count;
    mergedGeometry.setIndex(new THREE.BufferAttribute(indexArr, 1));
    shaft.dispose();
    head.dispose();

    const resultCount = sampledNodes.length;
    const quaternionsList = new Float32Array(resultCount * 4);
    const scalesList = new Float32Array(resultCount * 3);
    const colorsList = new Float32Array(resultCount * 3);

    const _dir = new THREE.Vector3();
    const _defaultUp = new THREE.Vector3(0, 0, 1);
    const _color = new THREE.Color();
    const _dummyQ = new THREE.Quaternion();

    for (let i = 0; i < resultCount; i++) {
      const ni = sampledNodes[i];
      const px = nodes[ni * 3] - center.x;
      const py = nodes[ni * 3 + 1] - center.y;
      const pz = nodes[ni * 3 + 2] - center.z;
      const vx = fld.x[ni] ?? 0;
      const vy = fld.y[ni] ?? 0;
      const vz = fld.z[ni] ?? 0;
      const len = Math.sqrt(vx * vx + vy * vy + vz * vz);

      if (len < 1e-12) {
        scalesList[i * 3] = 0; scalesList[i * 3 + 1] = 0; scalesList[i * 3 + 2] = 0;
        _dummyQ.identity();
      } else {
        scalesList[i * 3] = 1; scalesList[i * 3 + 1] = 1; scalesList[i * 3 + 2] = 1;
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
      
      // We also need positions for the InstancedMesh, let's embed them into a positionsList
      // wait, where's positionsList? I'll merge positions, quaternions, scales into a matrix update in useEffect
    }

    return { 
      mergedGeometry, 
      scales: scalesList, 
      quaternions: quaternionsList, 
      colors: colorsList, 
      count: resultCount,
      positions: sampledNodes.map(ni => [nodes[ni * 3] - center.x, nodes[ni * 3 + 1] - center.y, nodes[ni * 3 + 2] - center.z])
    };
  }, [meshData, field, arrowDensity, center, maxDim, visible]);

  useEffect(() => {
    if (!meshRef.current || count === 0 || !mergedGeometry) return;
    
    const dummy = new THREE.Object3D();
    for (let i = 0; i < count; i++) {
        dummy.position.set(positions[i][0], positions[i][1], positions[i][2]);
        dummy.quaternion.set(quaternions[i * 4], quaternions[i * 4 + 1], quaternions[i * 4 + 2], quaternions[i * 4 + 3]);
        dummy.scale.set(scales[i * 3], scales[i * 3 + 1], scales[i * 3 + 2]);
        dummy.updateMatrix();
        meshRef.current.setMatrixAt(i, dummy.matrix);
    }
    meshRef.current.instanceMatrix.needsUpdate = true;
    if (meshRef.current.instanceColor) {
        meshRef.current.instanceColor.needsUpdate = true;
    }
    invalidate();
  }, [count, mergedGeometry, positions, quaternions, scales, invalidate]);

  if (!visible || count === 0) return null;

  return (
    <instancedMesh ref={meshRef} args={[mergedGeometry!, undefined, count]} frustumCulled={false}>
      <meshPhongMaterial shininess={60} />
      <instancedBufferAttribute attach="instanceColor" args={[colors!, 3]} />
    </instancedMesh>
  );
}
