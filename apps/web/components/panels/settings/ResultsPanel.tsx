"use client";

import { useControlRoom } from "../../runs/control-room/ControlRoomContext";
import { fmtPreviewEveryN, fmtPreviewMaxPoints, type PreviewComponent } from "../../runs/control-room/shared";
import { Button } from "../../ui/button";
import { SidebarSection } from "./primitives";
import SelectField from "../../ui/SelectField";

export default function ResultsPanel() {
  const ctx = useControlRoom();
  return (
    <div className="flex flex-col gap-0 border-t border-border/20">
      <SidebarSection title="Active Preview State" defaultOpen={true}>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1 rounded-lg border border-border/30 bg-card/30 p-2.5">
            <span className="text-[0.65rem] font-bold uppercase tracking-widest text-muted-foreground">Quantity</span>
            <span className="font-mono text-xs text-foreground">{ctx.selectedQuantity}</span>
          </div>
          <div className="flex flex-col gap-1 rounded-lg border border-border/30 bg-card/30 p-2.5">
            <span className="text-[0.65rem] font-bold uppercase tracking-widest text-muted-foreground">Component</span>
            <span className="font-mono text-xs text-foreground">{ctx.requestedPreviewComponent}</span>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-start gap-1.5">
          {ctx.quickPreviewTargets.map((target) => (
            <Button
              key={target.id}
              size="sm"
              variant={ctx.requestedPreviewQuantity === target.id ? "solid" : "outline"}
              tone={ctx.requestedPreviewQuantity === target.id ? "accent" : "default"}
              disabled={!target.available || ctx.previewBusy}
              onClick={() => ctx.requestPreviewQuantity(target.id)}
            >
              {target.shortLabel}
            </Button>
          ))}
        </div>
      </SidebarSection>

      {ctx.previewControlsActive && (
        <SidebarSection title="Preview Controls" defaultOpen={true}>
          <div className="grid grid-cols-2 gap-3">
            <SelectField
              label="Quantity"
              value={ctx.selectedQuantity}
              onchange={(val) => ctx.requestPreviewQuantity(val)}
              disabled={ctx.previewBusy}
              options={ctx.quantityOptions.map((o) => ({ value: o.value, label: o.label, disabled: o.disabled }))}
              tooltip="Select the physical quantity to render in the active viewport."
            />
            <SelectField
              label="Component"
              value={ctx.requestedPreviewComponent}
              onchange={(val) => void ctx.updatePreview("/component", { component: val as PreviewComponent })}
              disabled={ctx.previewBusy}
              options={[
                { value: "3D", label: "3D Vector" },
                { value: "x", label: "x scalar" },
                { value: "y", label: "y scalar" },
                { value: "z", label: "z scalar" },
              ]}
              tooltip="Select which spatial component (or the full 3D vector) of the field to preview."
            />
            <SelectField
              label="Refresh Rate"
              value={String(ctx.requestedPreviewEveryN)}
              onchange={(val) => void ctx.updatePreview("/everyN", { everyN: Number(val) })}
              disabled={ctx.previewBusy}
              options={ctx.previewEveryNOptions.map((v) => ({ value: String(v), label: fmtPreviewEveryN(v) }))}
              tooltip="Control how frequently the live preview fetches standard fields from the running GPU block."
            />
            <SelectField
              label="Max Points"
              value={String(ctx.requestedPreviewMaxPoints)}
              onchange={(val) => void ctx.updatePreview("/maxPoints", { maxPoints: Number(val) })}
              disabled={ctx.previewBusy}
              options={ctx.previewMaxPointOptions.map((v) => ({ value: String(v), label: fmtPreviewMaxPoints(v) }))}
              tooltip="Limit the number of rendering points to improve browser frame rates during live playback."
            />

            <label className="col-span-2 flex h-8 items-center justify-start gap-2 rounded-md border border-border/60 bg-background/50 px-2.5 text-xs font-semibold text-foreground transition-colors hover:bg-background/80">
              <input
                type="checkbox"
                className="accent-primary"
                checked={ctx.requestedPreviewAutoScale}
                onChange={(e) => void ctx.updatePreview("/autoScaleEnabled", { autoScaleEnabled: e.target.checked })}
                disabled={ctx.previewBusy}
              />
              <span className="mt-px uppercase tracking-widest text-[0.65rem] font-bold text-muted-foreground">Auto-fit Camera Bounds</span>
            </label>
          </div>
        </SidebarSection>
      )}
    </div>
  );
}
