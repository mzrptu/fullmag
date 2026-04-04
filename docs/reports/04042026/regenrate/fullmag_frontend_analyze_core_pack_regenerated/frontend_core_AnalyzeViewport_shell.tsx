// Suggested placement:
// apps/web/components/runs/control-room/AnalyzeViewport.tsx
//
// Core shell after refactor.
// Uses shared state + shared artifact hook.

"use client";

import { useEffect, useMemo } from "react";
import EmptyState from "@/components/ui/EmptyState";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import ModeSpectrumPlot from "@/components/analyze/ModeSpectrumPlot";
import DispersionBranchPlot from "@/components/analyze/DispersionBranchPlot";
import EigenModeInspector from "@/components/analyze/EigenModeInspector";
import { useModel } from "./ControlRoomContext";
import { useAnalyzeArtifacts } from "./useAnalyzeArtifacts";

export default function AnalyzeViewport() {
  const model = useModel();
  const {
    loadState,
    modeLoadState,
    error,
    modeError,
    mesh,
    spectrum,
    dispersionRows,
    modeCache,
    hasEigenArtifacts,
    refresh,
    ensureMode,
  } = useAnalyzeArtifacts(model.analyzeSelection.refreshNonce);

  const selectedMode = model.analyzeSelection.selectedModeIndex;
  const selectedModeArtifact =
    selectedMode != null ? (modeCache[selectedMode] ?? null) : null;

  useEffect(() => {
    if (
      spectrum &&
      model.analyzeSelection.tab === "modes" &&
      model.analyzeSelection.selectedModeIndex == null &&
      spectrum.modes.length > 0
    ) {
      model.selectAnalyzeMode?.(spectrum.modes[0].index);
    }
  }, [model, spectrum]);

  useEffect(() => {
    if (selectedMode != null) {
      void ensureMode(selectedMode);
    }
  }, [ensureMode, selectedMode]);

  if (loadState === "loading") {
    return (
      <div className="flex h-full items-center justify-center">
        <EmptyState
          title="Loading eigen data"
          description="Fetching spectrum and artifacts from the active session."
          tone="info"
          compact
        />
      </div>
    );
  }

  if (loadState === "error") {
    return (
      <div className="flex h-full items-center justify-center">
        <EmptyState
          title="Analyze unavailable"
          description={error ?? "No active eigen data."}
          tone="warning"
          compact
        />
      </div>
    );
  }

  if (!hasEigenArtifacts || !spectrum) {
    return (
      <div className="flex h-full items-center justify-center">
        <EmptyState
          title="No eigen artifacts"
          description="Run an eigenmodes study and save spectrum/modes to unlock Analyze."
          tone="info"
          compact
        />
      </div>
    );
  }

  return (
    <Tabs
      value={model.analyzeSelection.tab}
      onValueChange={(value) => model.selectAnalyzeTab?.(value as any)}
      className="h-full flex flex-col"
    >
      <div className="shrink-0 border-b border-border/20 px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <TabsList className="h-8">
            <TabsTrigger value="spectrum">Spectrum</TabsTrigger>
            <TabsTrigger value="modes">Modes</TabsTrigger>
            {dispersionRows.length > 0 && (
              <TabsTrigger value="dispersion">Dispersion</TabsTrigger>
            )}
          </TabsList>

          <button
            type="button"
            className="rounded border px-2 py-1 text-xs"
            onClick={refresh}
          >
            Refresh
          </button>
        </div>
      </div>

      <TabsContent value="spectrum" className="flex-1 min-h-0 p-3">
        <ModeSpectrumPlot
          modes={spectrum.modes}
          selectedMode={selectedMode}
          onSelectMode={(index) => model.selectAnalyzeMode?.(index)}
        />
      </TabsContent>

      <TabsContent value="modes" className="flex-1 min-h-0 p-0">
        {selectedMode == null ? (
          <div className="flex h-full items-center justify-center">
            <EmptyState
              title="No mode selected"
              description="Choose a mode from the spectrum or the tree."
              tone="info"
              compact
            />
          </div>
        ) : modeLoadState === "error" ? (
          <div className="flex h-full items-center justify-center">
            <EmptyState
              title="Mode unavailable"
              description={modeError ?? "Mode artifact could not be loaded."}
              tone="warning"
              compact
            />
          </div>
        ) : (
          <EigenModeInspector
            mesh={mesh}
            mode={selectedModeArtifact}
            loading={modeLoadState === "loading"}
            compact
          />
        )}
      </TabsContent>

      {dispersionRows.length > 0 && (
        <TabsContent value="dispersion" className="flex-1 min-h-0 p-3">
          <DispersionBranchPlot
            rows={dispersionRows}
            selectedMode={selectedMode}
            onSelectMode={(index) => model.selectAnalyzeMode?.(index)}
          />
        </TabsContent>
      )}
    </Tabs>
  );
}
