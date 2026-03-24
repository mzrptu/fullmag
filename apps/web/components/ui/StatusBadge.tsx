"use client";

import s from "./StatusBadge.module.css";

type Tone = "default" | "accent" | "info" | "warn" | "danger" | "success";

interface StatusBadgeProps {
  label: string;
  tone?: Tone;
  pulse?: boolean;
}

export default function StatusBadge({
  label,
  tone = "default",
  pulse = false,
}: StatusBadgeProps) {
  return (
    <span className={s.uiBadge} data-tone={tone} data-pulse={pulse}>
      <span className={s.dot} aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}
