"use client";

import { ReactNode } from "react";
import s from "./Panel.module.css";

type Tone = "default" | "accent" | "info" | "warn" | "danger" | "success";

interface PanelProps {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  panelId?: string;
  tone?: Tone;
  actions?: ReactNode;
  children: ReactNode;
}

export default function Panel({
  title,
  subtitle,
  eyebrow,
  panelId,
  tone = "default",
  actions,
  children,
}: PanelProps) {
  return (
    <section className={s.uiPanel} data-tone={tone} data-panel={panelId}>
      <header className={s.header}>
        <div className={s.heading}>
          {eyebrow && <p className={s.eyebrow}>{eyebrow}</p>}
          <div className={s.titles}>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
        </div>
        {actions && <div className={s.actions}>{actions}</div>}
      </header>
      <div className={s.body}>{children}</div>
    </section>
  );
}
