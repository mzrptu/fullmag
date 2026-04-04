// Suggested placement:
// apps/web/components/runs/control-room/RunSidebar.tsx

import { parseAnalyzeTreeNode } from "./analyzeSelection";

// inside handleTreeClick(id: string):
const analyzeTarget = parseAnalyzeTreeNode(id);
if (analyzeTarget) {
  model.openAnalyze?.(analyzeTarget);
  return;
}

// example explicit variant:
if (id === "analyze-root" || id === "analyze-spectrum") {
  model.openAnalyze?.({
    tab: "spectrum",
    selectedModeIndex: null,
  });
  return;
}

if (id === "analyze-modes") {
  model.openAnalyze?.({
    tab: "modes",
    selectedModeIndex: model.analyzeSelection?.selectedModeIndex ?? 0,
  });
  return;
}

if (id.startsWith("analyze-mode-")) {
  const index = Number(id.replace("analyze-mode-", ""));
  if (Number.isFinite(index)) {
    model.openAnalyze?.({
      tab: "modes",
      selectedModeIndex: index,
    });
    return;
  }
}

if (id === "analyze-dispersion") {
  model.openAnalyze?.({
    tab: "dispersion",
    selectedModeIndex: null,
  });
  return;
}
