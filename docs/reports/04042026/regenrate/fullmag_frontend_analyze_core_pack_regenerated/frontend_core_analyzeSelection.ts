// Suggested placement:
// apps/web/components/runs/control-room/analyzeSelection.ts

export type AnalyzeTab = "spectrum" | "modes" | "dispersion";

export interface AnalyzeSelectionState {
  enabled: boolean;
  tab: AnalyzeTab;
  selectedModeIndex: number | null;
  refreshNonce: number;
}

export const DEFAULT_ANALYZE_SELECTION: AnalyzeSelectionState = {
  enabled: false,
  tab: "spectrum",
  selectedModeIndex: null,
  refreshNonce: 0,
};

export function analyzeModeNodeId(index: number): string {
  return `analyze-mode-${index}`;
}

export function parseAnalyzeTreeNode(
  nodeId: string,
): Partial<AnalyzeSelectionState> | null {
  if (nodeId === "analyze-root" || nodeId === "analyze-spectrum") {
    return { enabled: true, tab: "spectrum", selectedModeIndex: null };
  }
  if (nodeId === "analyze-modes") {
    return { enabled: true, tab: "modes" };
  }
  if (nodeId === "analyze-dispersion") {
    return { enabled: true, tab: "dispersion", selectedModeIndex: null };
  }
  if (nodeId.startsWith("analyze-mode-")) {
    const index = Number(nodeId.replace("analyze-mode-", ""));
    if (Number.isFinite(index)) {
      return { enabled: true, tab: "modes", selectedModeIndex: index };
    }
  }
  return null;
}

export function nextAnalyzeRefresh(
  current: AnalyzeSelectionState,
): AnalyzeSelectionState {
  return {
    ...current,
    refreshNonce: current.refreshNonce + 1,
  };
}
