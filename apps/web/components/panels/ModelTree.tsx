"use client";

import { useState, useCallback } from "react";
import s from "./ModelTree.module.css";

/* ── Types ─────────────────────────────────────────────────────────── */

export type NodeStatus = "ready" | "active" | "pending" | "error";

export interface TreeNodeData {
  id: string;
  label: string;
  icon?: string;
  badge?: string;
  status?: NodeStatus;
  children?: TreeNodeData[];
  onClick?: () => void;
}

interface ModelTreeProps {
  nodes: TreeNodeData[];
  activeId?: string | null;
  onNodeClick?: (id: string) => void;
  className?: string;
}

/* ── Tree Node ─────────────────────────────────────────────────────── */

function TreeNode({
  node,
  depth,
  activeId,
  onNodeClick,
}: {
  node: TreeNodeData;
  depth: number;
  activeId?: string | null;
  onNodeClick?: (id: string) => void;
}) {
  const [open, setOpen] = useState(depth < 2);
  const hasChildren = node.children && node.children.length > 0;

  const handleClick = useCallback(() => {
    if (hasChildren) setOpen((prev) => !prev);
    node.onClick?.();
    onNodeClick?.(node.id);
  }, [hasChildren, node, onNodeClick]);

  return (
    <div className={s.node}>
      <div
        className={s.nodeRow}
        style={{ "--depth": depth } as React.CSSProperties}
        data-active={activeId === node.id ? "true" : undefined}
        onClick={handleClick}
        role="treeitem"
        aria-expanded={hasChildren ? open : undefined}
      >
        {hasChildren ? (
          <span className={s.chevron} data-open={open ? "true" : "false"}>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M3 1.5L7 5L3 8.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        ) : (
          <span className={s.chevronPlaceholder} />
        )}
        {node.icon && <span className={s.icon}>{node.icon}</span>}
        <span className={s.label}>{node.label}</span>
        {node.status && <span className={s.statusDot} data-status={node.status} />}
        {node.badge && <span className={s.badge}>{node.badge}</span>}
      </div>
      {hasChildren && open && (
        <div className={s.children} role="group">
          {node.children!.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              activeId={activeId}
              onNodeClick={onNodeClick}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ── ModelTree ──────────────────────────────────────────────────────── */

export default function ModelTree({
  nodes,
  activeId,
  onNodeClick,
  className,
}: ModelTreeProps) {
  return (
    <div className={`${s.tree} ${className ?? ""}`} role="tree">
      {nodes.map((node) => (
        <TreeNode
          key={node.id}
          node={node}
          depth={0}
          activeId={activeId}
          onNodeClick={onNodeClick}
        />
      ))}
    </div>
  );
}

/* ── Default model tree for Fullmag ───────────────────────────────── */

export function buildFullmagModelTree(opts: {
  backend?: string;
  geometryKind?: string;
  materialName?: string;
  meshStatus?: NodeStatus;
  meshElements?: number;
  solverStatus?: NodeStatus;
  onGeometryClick?: () => void;
  onMeshClick?: () => void;
  onMaterialClick?: () => void;
  onSolverClick?: () => void;
}): TreeNodeData[] {
  return [
    {
      id: "definitions",
      label: "Definitions",
      icon: "📋",
      children: [
        { id: "def-params", label: "Parameters", icon: "⚙" },
        { id: "def-variables", label: "Variables", icon: "𝑥" },
      ],
    },
    {
      id: "geometry",
      label: "Geometry",
      icon: "🔷",
      badge: opts.geometryKind ?? "—",
      status: "ready",
      onClick: opts.onGeometryClick,
      children: [
        { id: "geo-body", label: opts.geometryKind ?? "Body", icon: "◻" },
      ],
    },
    {
      id: "materials",
      label: "Materials",
      icon: "🧲",
      badge: opts.materialName ?? "—",
      status: "ready",
      onClick: opts.onMaterialClick,
      children: [
        { id: "mat-body", label: opts.materialName ?? "Material 1", icon: "●" },
      ],
    },
    {
      id: "mesh",
      label: "Mesh",
      icon: "◫",
      badge: opts.meshElements ? `${opts.meshElements.toLocaleString()} el` : "—",
      status: opts.meshStatus ?? "pending",
      onClick: opts.onMeshClick,
      children: [
        { id: "mesh-size", label: "Size", icon: "📏" },
        { id: "mesh-quality", label: "Quality", icon: "📊" },
      ],
    },
    {
      id: "solver",
      label: "Solver",
      icon: "⚙",
      badge: opts.backend ?? "—",
      status: opts.solverStatus ?? "pending",
      onClick: opts.onSolverClick,
      children: [
        { id: "solver-config", label: "Configuration", icon: "🔧" },
        { id: "solver-results", label: "Results", icon: "📈" },
      ],
    },
  ];
}
