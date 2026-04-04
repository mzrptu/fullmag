"use client";

import { useEffect, useMemo } from "react";

import type { AnalyzeSelectionState, AnalyzeTab } from "./analyzeSelection";
import { useCurrentAnalyzeArtifacts } from "./useCurrentAnalyzeArtifacts";

interface AnalyzeWorkspaceController {
  analyzeSelection: AnalyzeSelectionState;
  setSelectedModeIndex: (index: number | null) => void;
  setTab: (tab: AnalyzeTab) => void;
}

export function useAnalyzeWorkspaceState(
  controller: AnalyzeWorkspaceController,
) {
  const artifacts = useCurrentAnalyzeArtifacts(controller.analyzeSelection.refreshNonce);
  const selectedMode = controller.analyzeSelection.selectedModeIndex;

  const selectedModeArtifact =
    selectedMode != null ? (artifacts.modeCache[selectedMode] ?? null) : null;

  const selectedModeSummary = useMemo(
    () =>
      artifacts.spectrum?.modes.find((mode) => mode.index === selectedMode) ?? null,
    [artifacts.spectrum, selectedMode],
  );

  useEffect(() => {
    if (!artifacts.spectrum || artifacts.spectrum.modes.length === 0) {
      return;
    }
    if (controller.analyzeSelection.selectedModeIndex == null) {
      controller.setSelectedModeIndex(artifacts.spectrum.modes[0].index);
    }
  }, [artifacts.spectrum, controller]);

  useEffect(() => {
    if (selectedMode != null) {
      void artifacts.ensureMode(selectedMode);
    }
  }, [artifacts, selectedMode]);

  return {
    ...artifacts,
    selectedMode,
    selectedModeArtifact,
    selectedModeSummary,
    selectMode: controller.setSelectedModeIndex,
    selectTab: controller.setTab,
  };
}
