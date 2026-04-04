// File: fullmag_frontend_AnalyzeViewport_shell_v2.tsx
// Placement target:
//   apps/web/components/runs/control-room/AnalyzeViewportShell.v2.tsx
//
// Goal:
//   A solver-aware Analyze shell. It keeps the plot widgets you already have,
//   but adds a diagnostics rail and badge bar sourced from the runtime context.

"use client";

import { useMemo } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import ModeSpectrumPlot from "@/components/analyze/ModeSpectrumPlot";
import EigenModeInspector from "@/components/analyze/EigenModeInspector";
import DispersionBranchPlot from "@/components/analyze/DispersionBranchPlot";
import AnalyzeDiagnosticsPanel from "./AnalyzeDiagnosticsPanel";
import AnalyzeRuntimeBadges from "./AnalyzeRuntimeBadges";
import { useCommand, useModel } from "./ControlRoomContext";
import { useCurrentAnalyzeArtifacts } from "./useCurrentAnalyzeArtifacts";
import { useAnalyzeRuntimeDiagnostics } from "./useAnalyzeRuntimeDiagnostics";

export default function AnalyzeViewportShellV2() {
  const cmd = useCommand();
  const model = useModel();
  const artifacts = useCurrentAnalyzeArtifacts();

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
    selectedMode != null ? artifacts.modeCache[selectedMode] ?? null : null;

  const spectrum = artifacts.spectrum;

  const selectedModeSummary = useMemo(
    () => spectrum?.modes.find((mode) => mode.index === selectedMode) ?? null,
    [spectrum, selectedMode],
  );

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-background">
      <div className="shrink-0 border-b border-border/30 bg-card/30 px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-sm border border-border/40 bg-muted/50 px-1.5 py-0.5 text-[0.62rem] font-bold uppercase tracking-widest text-muted-foreground">
            Analyze
          </span>
          <AnalyzeRuntimeBadges badges={diagnostics.badges} />
        </div>

        {selectedModeSummary && (
          <div className="mt-2 text-sm text-foreground/90">
            Mode {selectedModeSummary.index} · {(selectedModeSummary.frequency_hz / 1e9).toFixed(4)} GHz
          </div>
        )}
      </div>

      <div className="flex flex-1 min-h-0 min-w-0 overflow-hidden">
        <div className="min-w-0 flex-1 overflow-hidden">
          <Tabs
            value={model.analyzeSelection.tab}
            onValueChange={(value) =>
              model.setAnalyzeSelection((prev) => ({
                ...prev,
                tab: value as "spectrum" | "modes" | "dispersion",
              }))
            }
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
                {artifacts.dispersionRows.length > 0 && (
                  <TabsTrigger value="dispersion" className="h-7 px-3 text-[0.72rem]">
                    Dispersion
                  </TabsTrigger>
                )}
              </TabsList>
            </div>

            <TabsContent value="spectrum" className="flex-1 min-h-0 p-3">
              {spectrum && (
                <ModeSpectrumPlot
                  modes={spectrum.modes}
                  selectedMode={selectedMode}
                  onSelectMode={(modeIndex) =>
                    model.setAnalyzeSelection((prev) => ({
                      ...prev,
                      tab: "modes",
                      selectedModeIndex: modeIndex,
                    }))
                  }
                />
              )}
            </TabsContent>

            <TabsContent value="modes" className="flex-1 min-h-0">
              <EigenModeInspector
                mesh={artifacts.mesh}
                mode={selectedModeArtifact}
                loading={artifacts.modeLoadState === "loading"}
                compact
              />
            </TabsContent>

            <TabsContent value="dispersion" className="flex-1 min-h-0 p-3">
              <DispersionBranchPlot
                rows={artifacts.dispersionRows}
                selectedMode={selectedMode}
                onSelectMode={(modeIndex) =>
                  model.setAnalyzeSelection((prev) => ({
                    ...prev,
                    tab: "modes",
                    selectedModeIndex: modeIndex,
                  }))
                }
              />
            </TabsContent>
          </Tabs>
        </div>

        <aside className="hidden w-[360px] shrink-0 border-l border-border/25 bg-card/20 p-3 xl:block">
          <AnalyzeDiagnosticsPanel diagnostics={diagnostics} />
        </aside>
      </div>
    </div>
  );
}
