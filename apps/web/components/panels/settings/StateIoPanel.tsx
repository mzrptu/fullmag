"use client";

import { useEffect, useState } from "react";
import { useControlRoom } from "../../runs/control-room/ControlRoomContext";
import { Button } from "../../ui/button";

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
    <div className="grid gap-3">
      <div className="grid gap-2">
        <label className="text-[0.65rem] font-bold uppercase tracking-widest text-muted-foreground">
          State Format
        </label>
        <select
          className="h-9 rounded-md border border-border/60 bg-background/80 px-2 text-sm"
          value={format}
          onChange={(event) => setFormat(event.target.value as "json" | "zarr" | "h5")}
          disabled={ctx.stateIoBusy}
        >
          <option value="json">JSON (.json)</option>
          <option value="zarr">Zarr (.zarr.zip)</option>
          <option value="h5">HDF5 (.h5)</option>
        </select>
      </div>

      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          type="button"
          disabled={ctx.stateIoBusy || !ctx.session}
          onClick={() => { void ctx.handleStateExport(format); }}
        >
          {ctx.stateIoBusy ? "Working…" : "Export State"}
        </Button>
      </div>

      <div className="grid gap-2 rounded-md border border-border/50 bg-muted/20 p-3">
        <label className="text-[0.65rem] font-bold uppercase tracking-widest text-muted-foreground">
          Import State
        </label>
        <input
          type="file"
          accept=".json,.h5,.hdf5,.zarr.zip"
          disabled={ctx.stateIoBusy}
          onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
          className="text-xs text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-primary/10 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-primary"
        />
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={applyToWorkspace}
            disabled={!canApplyToWorkspace || ctx.stateIoBusy}
            onChange={(event) => setApplyToWorkspace(event.target.checked)}
          />
          Apply to current workspace
        </label>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={attachToScriptBuilder}
            disabled={ctx.stateIoBusy}
            onChange={(event) => setAttachToScriptBuilder(event.target.checked)}
          />
          Persist in Script Builder for next sync
        </label>
        <Button
          size="sm"
          type="button"
          disabled={ctx.stateIoBusy || !selectedFile}
          onClick={handleImport}
        >
          {ctx.stateIoBusy ? "Working…" : "Import State"}
        </Button>
        {!canApplyToWorkspace && (
          <div className="text-[0.68rem] leading-relaxed text-muted-foreground">
            Applying an imported state to the live workspace is available only while the session is
            waiting for compute or awaiting the next interactive command.
          </div>
        )}
      </div>

      {ctx.scriptInitialState && (
        <div className="grid gap-1 rounded-md border border-border/40 bg-background/40 p-3">
          <span className="text-[0.65rem] font-bold uppercase tracking-widest text-muted-foreground">
            Script Initial State
          </span>
          <span className="font-mono text-xs text-muted-foreground break-all">
            {ctx.scriptInitialState.source_path}
          </span>
          <span className="text-[0.68rem] text-muted-foreground">
            Format: {ctx.scriptInitialState.format}
            {ctx.scriptInitialState.dataset ? ` · Dataset: ${ctx.scriptInitialState.dataset}` : ""}
          </span>
        </div>
      )}

      {ctx.stateIoMessage && (
        <div className="text-[0.68rem] leading-relaxed text-muted-foreground p-2 rounded-md bg-muted/30 border border-border/40">
          {ctx.stateIoMessage}
        </div>
      )}
    </div>
  );
}
