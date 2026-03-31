"use client";

import { useModel } from "../../runs/control-room/ControlRoomContext";
import { fmtSI } from "../../runs/control-room/shared";

export default function MaterialPanel() {
  const model = useModel();
  if (!model.material) return <div className="font-mono text-xs text-foreground">Material metadata not available yet.</div>;
  return (
    <>
      <div className="grid grid-cols-3 gap-3">
        <div className="flex flex-col gap-1 p-2.5 bg-card/30 border border-border/30 rounded-lg">
          <span className="text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground">M_sat</span>
          <span className="font-mono text-xs text-foreground">{model.material.msat != null ? fmtSI(model.material.msat, "A/m") : "—"}</span>
        </div>
        <div className="flex flex-col gap-1 p-2.5 bg-card/30 border border-border/30 rounded-lg">
          <span className="text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground">A_ex</span>
          <span className="font-mono text-xs text-foreground">{model.material.aex != null ? fmtSI(model.material.aex, "J/m") : "—"}</span>
        </div>
        <div className="flex flex-col gap-1 p-2.5 bg-card/30 border border-border/30 rounded-lg">
          <span className="text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground">α</span>
          <span className="font-mono text-xs text-foreground">{model.material.alpha?.toPrecision(3) ?? "—"}</span>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5 mt-3">
        {model.material.exchangeEnabled && <span className="text-[0.55rem] font-medium uppercase tracking-wider border border-border/30 bg-card/20 text-muted-foreground px-1.5 py-0.5 rounded-md inline-flex w-fit">Exchange</span>}
        {model.material.demagEnabled && <span className="text-[0.55rem] font-medium uppercase tracking-wider border border-border/30 bg-card/20 text-muted-foreground px-1.5 py-0.5 rounded-md inline-flex w-fit">Demag</span>}
        {model.material.zeemanField?.some((v) => v !== 0) && <span className="text-[0.55rem] font-medium uppercase tracking-wider border border-border/30 bg-card/20 text-muted-foreground px-1.5 py-0.5 rounded-md inline-flex w-fit">Zeeman</span>}
      </div>
    </>
  );
}
