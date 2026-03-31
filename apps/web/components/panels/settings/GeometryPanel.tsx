"use client";

import { useModel } from "../../runs/control-room/ControlRoomContext";
import { fmtSI } from "../../runs/control-room/shared";

export default function GeometryPanel() {
  const model = useModel();
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="flex flex-col gap-1 p-2.5 bg-card/30 border border-border/30 rounded-lg">
        <span className="text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground">Geometry</span>
        <span className="font-mono text-xs text-foreground">{model.meshName ?? model.mesherSourceKind ?? "—"}</span>
      </div>
      <div className="flex flex-col gap-1 p-2.5 bg-card/30 border border-border/30 rounded-lg">
        <span className="text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground">Source</span>
        <span className="font-mono text-xs text-foreground">{model.meshSource ?? model.mesherSourceKind ?? "—"}</span>
      </div>
      <div className="flex flex-col gap-1 p-2.5 bg-card/30 border border-border/30 rounded-lg">
        <span className="text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground">Extent</span>
        <span className="font-mono text-xs text-foreground">
          {model.meshExtent
            ? `${fmtSI(model.meshExtent[0], "m")} · ${fmtSI(model.meshExtent[1], "m")} · ${fmtSI(model.meshExtent[2], "m")}`
            : "—"}
        </span>
      </div>
      <div className="flex flex-col gap-1 p-2.5 bg-card/30 border border-border/30 rounded-lg">
        <span className="text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground">Bounds</span>
        <span className="font-mono text-xs text-foreground">
          {model.meshBoundsMin && model.meshBoundsMax
            ? `${fmtSI(model.meshBoundsMin[0], "m")} → ${fmtSI(model.meshBoundsMax[0], "m")}`
            : "—"}
        </span>
      </div>
    </div>
  );
}
