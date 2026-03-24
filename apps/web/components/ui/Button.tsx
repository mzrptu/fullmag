"use client";

import { ButtonHTMLAttributes, ReactNode } from "react";
import s from "./Button.module.css";

type Variant = "solid" | "outline" | "subtle" | "ghost";
type Tone = "default" | "accent" | "info" | "warn" | "danger" | "success";
type Size = "sm" | "md";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  tone?: Tone;
  size?: Size;
  children: ReactNode;
}

export default function Button({
  variant = "subtle",
  tone = "default",
  size = "md",
  children,
  className,
  ...rest
}: ButtonProps) {
  const classes = [
    s.uiButton,
    s[variant],
    size === "sm" ? s.sm : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button className={classes} data-tone={tone} {...rest}>
      {children}
    </button>
  );
}
