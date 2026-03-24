"use client";

import s from "./SegmentedControl.module.css";

interface SegmentOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface SegmentedControlProps {
  label?: string;
  value: string;
  options: SegmentOption[];
  onchange?: (value: string) => void;
}

export default function SegmentedControl({
  label,
  value,
  options,
  onchange,
}: SegmentedControlProps) {
  return (
    <div className={s.wrapper}>
      {label && <span className={s.label}>{label}</span>}
      <div className={s.segmented}>
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            className={s.option}
            data-active={value === opt.value}
            disabled={opt.disabled}
            onClick={() => onchange?.(opt.value)}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}
