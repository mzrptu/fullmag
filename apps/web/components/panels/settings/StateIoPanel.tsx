"use client";

import { useEffect, useState } from "react";
import { useControlRoom } from "../../runs/control-room/ControlRoomContext";
import { Button } from "../../ui/button";
import { SidebarSection } from "./primitives";
import SelectField from "../../ui/SelectField";

export default function StateIoPanel() {
  const ctx = useControlRoom();
  const [format, setFormat] = useState<"json" | "zarr" | "h5">("json");
  const [applyToWorkspace, setApplyToWorkspace] = useState(true);
  const [attachToScriptBuilder, setAttachToScriptBuilder] = useState(true);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  useEffect(() => {
    if (!ctx.awaitingCommand && !ctx.isWaitingForCompute) {
      setApplyToWorkspace(false);
    }
  }, [ctx.awaitingCommand, ctx.isWaitingForCompute]);

  const canApplyToWorkspace = ctx.awaitingCommand || ctx.isWaitingForCompute;

  const handleImport = () => {
    if (!selectedFile) return;
    void ctx.handleStateImport(selectedFile, {
      applyToWorkspace: canApplyToWorkspace && applyToWorkspace,
      attachToScriptBuilder,
    });
  };

  return (
    <div className="flex flex-col pt-4 px-2">
      <SidebarSection title="Export State" defaultOpen={true}>
        <div className="grid gap-2">
          <SelectField
            label="State Format"
            value={format}
            onchange={(val) => setFormat(val as "json" | "zarr" | "h5")}
            disabled={ctx.stateIoBusy}
            options={[
              { value: "json", label: "JSON (.json)" },
              { value: "zarr", label: "Zarr (.zarr.zip)" },
              { value: "h5", label: "HDF5 (.h5)" },
            ]}
            tooltip="Select the format for the exported state file. JSON is human-readable but large, Zarr and HDF5 are binary formats suitable for large models."
          />
        </div>

        <div className="flex gap-2 mt-3">
          <Button
            size="sm"
            variant="outline"
            type="button"
            className="w-full"
            disabled={ctx.stateIoBusy || !ctx.session}
            onClick={() => { void ctx.handleStateExport(format); }}
          >
            {ctx.stateIoBusy ? "Working…" : "Export State"}
          </Button>
        </div>
      </SidebarSection>

      <SidebarSection title="Import State" defaultOpen={true}>
        <div className="grid gap-2">
          <input
            type="file"
            accept=".json,.h5,.hdf5,.zarr.zip"
            disabled={ctx.stateIoBusy}
            onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
            className="text-xs text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-primary/10 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-primary"
          />
          <label className="flex items-center gap-2 text-[0.7rem] text-muted-foreground transition-colors hover:text-foreground">
            <input
              type="checkbox"
              className="accent-primary"
              checked={applyToWorkspace}
              disabled={!canApplyToWorkspace || ctx.stateIoBusy}
              onChange={(event) => setApplyToWorkspace(event.target.checked)}
            />
            Apply to current workspace
          </label>
          <label className="flex items-center gap-2 text-[0.7rem] text-muted-foreground transition-colors hover:text-foreground">
            <input
              type="checkbox"
              className="accent-primary"
              checked={attachToScriptBuilder}
              disabled={ctx.stateIoBusy}
              onChange={(event) => setAttachToScriptBuilder(event.target.checked)}
            />
            Persist in Script Builder for next sync
          </label>
          <Button
            size="sm"
            variant="outline"
            type="button"
            className="mt-1 w-full"
            disabled={ctx.stateIoBusy || !selectedFile}
            onClick={handleImport}
          >
            {ctx.stateIoBusy ? "Working…" : "Import State"}
          </Button>
          {!canApplyToWorkspace && (
            <div className="text-[0.68rem] leading-relaxed text-muted-foreground/80 border border-border/30 bg-background/30 p-2.5 rounded-lg mt-1">
              Applying an imported state to the live workspace is available only while the session is
              waiting for compute or awaiting the next interactive command.
            </div>
          )}
        </div>
      </SidebarSection>

      {ctx.scriptInitialState && (
        <SidebarSection title="Script Initial State" defaultOpen={false}>
          <div className="grid gap-1 rounded-md border border-border/40 bg-background/40 p-3">
            <span className="font-mono text-xs text-foreground break-all">
              {ctx.scriptInitialState.source_path}
            </span>
            <span className="text-[0.68rem] text-muted-foreground">
              Format: {ctx.scriptInitialState.format}
              {ctx.scriptInitialState.dataset ? ` · Dataset: ${ctx.scriptInitialState.dataset}` : ""}
            </span>
          </div>
        </SidebarSection>
      )}

      {ctx.stateIoMessage && (
        <div className="p-3">
          <div className="text-[0.68rem] leading-relaxed text-muted-foreground p-3 rounded-md bg-muted/40 border border-border/50">
            {ctx.stateIoMessage}
          </div>
        </div>
      )}
    </div>
  );
}
