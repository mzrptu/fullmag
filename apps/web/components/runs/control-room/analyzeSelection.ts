"use client";

export type AnalyzeTab = "spectrum" | "modes" | "dispersion";

export interface AnalyzeSelectionState {
  tab: AnalyzeTab;
  selectedModeIndex: number | null;
  /** k-sample index for multi-k (path) solves. Null means legacy single-sample. */
  sampleIndex: number | null;
  /** Tracked branch id. Null means no branch selected. */
  branchId: number | null;
  refreshNonce: number;
}

export const DEFAULT_ANALYZE_SELECTION: AnalyzeSelectionState = {
  tab: "spectrum",
  selectedModeIndex: null,
  sampleIndex: null,
  branchId: null,
  refreshNonce: 0,
};

export function nextAnalyzeRefresh(
  current: AnalyzeSelectionState,
): AnalyzeSelectionState {
  return {
    ...current,
    refreshNonce: current.refreshNonce + 1,
  };
}

export function parseAnalyzeTreeNode(
  nodeId: string,
): Partial<AnalyzeSelectionState> | null {
  if (nodeId === "res-eigenmodes" || nodeId === "res-eigenmodes-spectrum") {
    return { tab: "spectrum", selectedModeIndex: null };
  }
  if (nodeId === "res-eigenmodes-dispersion") {
    return { tab: "dispersion", selectedModeIndex: null };
  }
  if (nodeId.startsWith("res-eigenmode-")) {
    const index = Number(nodeId.replace("res-eigenmode-", ""));
    if (Number.isFinite(index)) {
      return { tab: "modes", selectedModeIndex: index };
    }
  }
  return null;
}
