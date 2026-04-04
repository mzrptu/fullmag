// Suggested placement:
// apps/web/components/runs/control-room/ControlRoomContext.tsx
//
// This is a patch-oriented scaffold, not a direct replacement.

import {
  DEFAULT_ANALYZE_SELECTION,
  type AnalyzeSelectionState,
  type AnalyzeTab,
  nextAnalyzeRefresh,
} from "./analyzeSelection";

// inside provider state:
const [analyzeSelection, setAnalyzeSelection] =
  useState<AnalyzeSelectionState>(DEFAULT_ANALYZE_SELECTION);

// recommended helpers:
const openAnalyze = useCallback((next?: Partial<AnalyzeSelectionState>) => {
  startTransition(() => {
    setViewMode("Analyze");
  });
  setAnalyzeSelection((prev) => ({
    ...prev,
    enabled: true,
    ...next,
  }));
}, []);

const selectAnalyzeTab = useCallback((tab: AnalyzeTab) => {
  setAnalyzeSelection((prev) => ({
    ...prev,
    enabled: true,
    tab,
  }));
}, []);

const selectAnalyzeMode = useCallback((index: number | null) => {
  setAnalyzeSelection((prev) => ({
    ...prev,
    enabled: true,
    tab: "modes",
    selectedModeIndex: index,
  }));
}, []);

const refreshAnalyze = useCallback(() => {
  setAnalyzeSelection((prev) => nextAnalyzeRefresh(prev));
}, []);

// expose through context value:
analyzeSelection,
setAnalyzeSelection,
openAnalyze,
selectAnalyzeTab,
selectAnalyzeMode,
refreshAnalyze,

// optionally:
// if the workspace changes, reset Analyze selection
useEffect(() => {
  setAnalyzeSelection(DEFAULT_ANALYZE_SELECTION);
}, [workspaceHydrationKey]);
