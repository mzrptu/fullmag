"use client";

import s from "./Slider.module.css";

interface Props {
  label: string;
  value: number;
  values: number[];
  onChange: (value: number) => void;
  disabled?: boolean;
}

export default function Slider({
  label,
  value,
  values,
  onChange,
  disabled = false,
}: Props) {
  const index = values.indexOf(value);
  const pos = index >= 0 ? index : 0;

  return (
    <div className={s.wrapper}>
      <div className={s.header}>
        <span className={s.label}>{label}</span>
        <span className={s.value}>{value}</span>
      </div>
      <input
        type="range"
        className={s.track}
        min={0}
        max={values.length - 1}
        step={1}
        value={pos}
        disabled={disabled}
        onChange={(e) => {
          const idx = parseInt(e.target.value);
          if (values[idx] !== undefined) onChange(values[idx]);
        }}
      />
    </div>
  );
}
