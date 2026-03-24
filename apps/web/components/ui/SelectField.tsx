"use client";

import s from "./SelectField.module.css";

export interface SelectOption {
  value: string;
  label: string;
  group?: string;
  disabled?: boolean;
}

interface SelectFieldProps {
  label: string;
  value: string | number;
  options: SelectOption[];
  onchange?: (value: string) => void;
}

export default function SelectField({
  label,
  value,
  options,
  onchange,
}: SelectFieldProps) {
  return (
    <div className={s.uiSelect}>
      <span className={s.label}>{label}</span>
      <span className={s.control}>
        <select
          value={String(value)}
          onChange={(e) => onchange?.(e.target.value)}
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value} disabled={opt.disabled}>
              {opt.label}
            </option>
          ))}
        </select>
      </span>
    </div>
  );
}
