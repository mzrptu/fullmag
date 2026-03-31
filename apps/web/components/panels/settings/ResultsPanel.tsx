"use client";

import { useControlRoom } from "../../runs/control-room/ControlRoomContext";
import { fmtPreviewEveryN, fmtPreviewMaxPoints, type PreviewComponent } from "../../runs/control-room/shared";
import { Button } from "../../ui/button";

export default function ResultsPanel() {
  const ctx = useControlRoom();
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1 p-2.5 bg-gradient-to-br from-card/60 to-background/50 border border-white/5 shadow-md rounded-md ring-1 ring-inset ring-white/5">
          <span className="text-[0.65rem] font-bold uppercase tracking-widest text-muted-foreground">Quantity</span>
          <span className="font-mono text-xs text-foreground">{ctx.selectedQuantity}</span>
        </div>
        <div className="flex flex-col gap-1 p-2.5 bg-gradient-to-br from-card/60 to-background/50 border border-white/5 shadow-md rounded-md ring-1 ring-inset ring-white/5">
          <span className="text-[0.65rem] font-bold uppercase tracking-widest text-muted-foreground">Component</span>
          <span className="font-mono text-xs text-foreground">{ctx.requestedPreviewComponent}</span>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5 items-center justify-start mt-3">
        {ctx.quickPreviewTargets.map((target) => (
          <Button key={target.id} size="sm"
            variant={ctx.requestedPreviewQuantity === target.id ? "solid" : "outline"}
            tone={ctx.requestedPreviewQuantity === target.id ? "accent" : "default"}
            disabled={!target.available || ctx.previewBusy}
            onClick={() => ctx.requestPreviewQuantity(target.id)}
          >
            {target.shortLabel}
          </Button>
        ))}
      </div>
      {ctx.previewControlsActive && (
        <div className="grid grid-cols-2 gap-3 mt-5 p-3 rounded-lg border border-border/30 bg-muted/10">
          <label className="flex flex-col gap-1.5 text-[0.65rem] font-bold uppercase tracking-widest text-muted-foreground">
            Quantity
            <select className="flex h-7 w-full rounded-md border border-border/60 bg-background/50 px-2.5 py-1 text-xs text-foreground font-mono focus:border-primary focus:outline-none transition-colors shadow-sm disabled:opacity-50" value={ctx.selectedQuantity}
              onChange={(e) => ctx.requestPreviewQuantity(e.target.value)}
              disabled={ctx.previewBusy}
            >
              {ctx.quantityOptions.map((o) => <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-[0.65rem] font-bold uppercase tracking-widest text-muted-foreground">
            Component
            <select className="flex h-7 w-full rounded-md border border-border/60 bg-background/50 px-2.5 py-1 text-xs text-foreground font-mono focus:border-primary focus:outline-none transition-colors shadow-sm disabled:opacity-50" value={ctx.requestedPreviewComponent}
              onChange={(e) => void ctx.updatePreview("/component", { component: e.target.value as PreviewComponent })}
              disabled={ctx.previewBusy}
            >
              <option value="3D">3D</option>
              <option value="x">x</option>
              <option value="y">y</option>
              <option value="z">z</option>
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-[0.65rem] font-bold uppercase tracking-widest text-muted-foreground">
            Refresh
            <select className="flex h-7 w-full rounded-md border border-border/60 bg-background/50 px-2.5 py-1 text-xs text-foreground font-mono focus:border-primary focus:outline-none transition-colors shadow-sm disabled:opacity-50" value={ctx.requestedPreviewEveryN}
              onChange={(e) => void ctx.updatePreview("/everyN", { everyN: Number(e.target.value) })}
              disabled={ctx.previewBusy}
            >
              {ctx.previewEveryNOptions.map((v) => <option key={v} value={v}>{fmtPreviewEveryN(v)}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-[0.65rem] font-bold uppercase tracking-widest text-muted-foreground">
            Points
            <select className="flex h-7 w-full rounded-md border border-border/60 bg-background/50 px-2.5 py-1 text-xs text-foreground font-mono focus:border-primary focus:outline-none transition-colors shadow-sm disabled:opacity-50" value={ctx.requestedPreviewMaxPoints}
              onChange={(e) => void ctx.updatePreview("/maxPoints", { maxPoints: Number(e.target.value) })}
              disabled={ctx.previewBusy}
            >
              {ctx.previewMaxPointOptions.map((v) => <option key={v} value={v}>{fmtPreviewMaxPoints(v)}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-[0.65rem] font-bold uppercase tracking-widest text-muted-foreground items-end justify-center">
            <span className="flex items-center gap-2 mt-1 text-xs text-foreground font-medium select-none">
              <input type="checkbox" checked={ctx.requestedPreviewAutoScale}
                onChange={(e) => void ctx.updatePreview("/autoScaleEnabled", { autoScaleEnabled: e.target.checked })}
                disabled={ctx.previewBusy} />
              Auto-fit
            </span>
          </label>
        </div>
      )}
    </>
  );
}
