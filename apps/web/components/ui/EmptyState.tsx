"use client";

import { ReactNode } from "react";
import s from "./EmptyState.module.css";

interface EmptyStateProps {
  title: string;
  description?: string;
  tone?: string;
  compact?: boolean;
  children?: ReactNode;
}

export default function EmptyState({
  title,
  description,
  compact = false,
  children,
}: EmptyStateProps) {
  return (
    <div className={`${s.uiEmpty} ${compact ? s.compact : ""}`}>
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {children}
    </div>
  );
}
