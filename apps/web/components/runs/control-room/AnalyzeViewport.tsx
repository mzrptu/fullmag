"use client";

import { useEffect, useMemo } from "react";
import { RefreshCw } from "lucide-react";

import DispersionBranchPlot from "@/components/analyze/DispersionBranchPlot";
import EigenModeInspector from "@/components/analyze/EigenModeInspector";
import ModeSpectrumPlot from "@/components/analyze/ModeSpectrumPlot";
import EmptyState from "@/components/ui/EmptyState";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import AnalyzeDiagnosticsPanel from "./AnalyzeDiagnosticsPanel";
import AnalyzeRuntimeBadges from "./AnalyzeRuntimeBadges";
import { useCommand, useModel } from "./ControlRoomContext";
import { useCurrentAnalyzeArtifacts } from "./useCurrentAnalyzeArtifacts";
import { useAnalyzeRuntimeDiagnostics } from "./useAnalyzeRuntimeDiagnostics";

function fmtGHz(hz: number): string {
  return `${(hz / 1e9).toFixed(4)} GHz`;
}

export default function AnalyzeViewport() {
  const model = useModel();
  const cmd = useCommand();
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
  } = useCurrentAnalyzeArtifacts(model.analyzeSelection.refreshNonce);

  const diagnostics = useAnalyzeRuntimeDiagnostics({
    runtimeEngineLabel: cmd.runtimeEngineLabel,
    latestBackendError: cmd.latestBackendError,
    engineLog: cmd.engineLog,
    magneticParts: model.magneticParts,
    airPart: model.airPart,
    interfaceParts: model.interfaceParts,
    metadata: cmd.metadata,
  });

  const selectedMode = model.analyzeSelection.selectedModeIndex;
  const selectedModeArtifact =
    selectedMode != null ? (modeCache[selectedMode] ?? null) : null;
  const selectedModeSummary = useMemo(
    () => spectrum?.modes.find((mode) => mode.index === selectedMode) ?? null,
    [selectedMode, spectrum],
  );

  useEffect(() => {
    if (!spectrum || spectrum.modes.length === 0) {
      return;
    }
    if (model.analyzeSelection.selectedModeIndex == null) {
      model.setAnalyzeSelection((prev) => ({
        ...prev,
        selectedModeIndex: spectrum.modes[0].index,
      }));
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
          description="Run a FEM Eigenmodes study with saved spectrum or mode outputs to unlock Analyze."
          tone="info"
          compact
        />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-background">
      <div className="shrink-0 border-b border-border/30 bg-card/30 px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-sm border border-border/40 bg-muted/50 px-1.5 py-0.5 text-[0.62rem] font-bold uppercase tracking-widest text-muted-foreground">
            Analyze
          </span>
          <AnalyzeRuntimeBadges badges={diagnostics.badges} />
          <div className="flex-1" />
          <button
            type="button"
            title="Refresh analyze data"
            onClick={() => {
              model.refreshAnalyze();
              refresh();
            }}
            className="flex items-center gap-1 rounded-md border border-transparent px-2 py-1 text-[0.68rem] text-muted-foreground transition-colors hover:border-border/40 hover:bg-muted/60 hover:text-foreground"
          >
            <RefreshCw size={11} />
            Refresh
          </button>
        </div>

        {selectedModeSummary && (
          <div className="mt-2 text-sm text-foreground/90">
            Mode {selectedModeSummary.index} · {fmtGHz(selectedModeSummary.frequency_hz)} ·{" "}
            {selectedModeSummary.dominant_polarization}
          </div>
        )}
      </div>

      <div className="flex flex-1 min-h-0 min-w-0 overflow-hidden">
        <div className="min-w-0 flex-1 overflow-hidden">
          <Tabs
            value={model.analyzeSelection.tab}
            onValueChange={(value) => model.selectAnalyzeTab(value as "spectrum" | "modes" | "dispersion")}
            className="flex h-full flex-col"
          >
            <div className="shrink-0 border-b border-border/20 px-3 pt-2">
              <TabsList className="h-7 gap-0.5 bg-transparent p-0">
                <TabsTrigger value="spectrum" className="h-7 px-3 text-[0.72rem]">
                  Spectrum
                </TabsTrigger>
                <TabsTrigger value="modes" className="h-7 px-3 text-[0.72rem]">
                  Modes
                </TabsTrigger>
                {dispersionRows.length > 0 && (
                  <TabsTrigger value="dispersion" className="h-7 px-3 text-[0.72rem]">
                    Dispersion
                  </TabsTrigger>
                )}
              </TabsList>
            </div>

            <TabsContent value="spectrum" className="flex-1 min-h-0 p-3">
              <ModeSpectrumPlot
                modes={spectrum.modes}
                selectedMode={selectedMode}
                onSelectMode={(modeIndex) => model.selectAnalyzeMode(modeIndex)}
              />
            </TabsContent>

            <TabsContent value="modes" className="flex-1 min-h-0 p-0">
              {selectedMode == null ? (
                <div className="flex h-full items-center justify-center">
                  <EmptyState
                    title="No mode selected"
                    description="Choose a mode from the spectrum, dispersion plot, or outputs tree."
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
                  onSelectMode={(modeIndex) => model.selectAnalyzeMode(modeIndex)}
                />
              </TabsContent>
            )}
          </Tabs>
        </div>

        <aside className="hidden w-[360px] shrink-0 border-l border-border/25 bg-card/20 p-3 xl:block">
          <AnalyzeDiagnosticsPanel diagnostics={diagnostics} />
        </aside>
      </div>
    </div>
  );
}
