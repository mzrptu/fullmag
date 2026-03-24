"use client";

import s from "./ReadonlyField.module.css";

interface ReadonlyFieldProps {
  label: string;
  value: string;
  unit?: string;
  mono?: boolean;
}

export default function ReadonlyField({
  label,
  value,
  unit,
  mono = false,
}: ReadonlyFieldProps) {
  return (
    <div className={s.uiReadonly}>
      <div className={s.meta}>
        <span>{label}</span>
      </div>
      <div className={`${s.value} ${mono ? s.mono : ""}`}>
        <strong>{value}</strong>
        {unit && <span>{unit}</span>}
      </div>
    </div>
  );
}
