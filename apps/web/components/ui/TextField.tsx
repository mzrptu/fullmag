"use client";

import { InputHTMLAttributes } from "react";
import s from "./TextField.module.css";

interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "onChange"> {
  label?: string;
  unit?: string;
  mono?: boolean;
  onchange?: (event: React.ChangeEvent<HTMLInputElement>) => void;
}

export default function TextField({
  label,
  unit,
  mono = false,
  onchange,
  ...rest
}: TextFieldProps) {
  return (
    <label className={s.uiTextfield}>
      {label && (
        <span className={s.label}>
          <span>{label}</span>
        </span>
      )}
      <span className={`${s.control} ${mono ? s.mono : ""}`}>
        <input onChange={onchange} {...rest} />
        {unit && <span className={s.unit}>{unit}</span>}
      </span>
    </label>
  );
}
