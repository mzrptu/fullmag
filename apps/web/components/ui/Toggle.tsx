"use client";

import s from "./Toggle.module.css";

interface ToggleProps {
  label: string;
  checked: boolean;
  onchange?: (next: boolean) => void;
}

export default function Toggle({ label, checked, onchange }: ToggleProps) {
  return (
    <label className={s.uiToggle}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onchange?.((e.currentTarget as HTMLInputElement).checked)}
      />
      <span className={s.track} aria-hidden="true">
        <span className={s.thumb} />
      </span>
      <span className={s.label}>{label}</span>
    </label>
  );
}
