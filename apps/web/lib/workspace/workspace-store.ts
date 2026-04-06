import { create } from "zustand";
import type { LaunchIntent } from "./launch-intent";

export type WorkspaceMode = "build" | "study" | "analyze";

interface StageLayoutState {
  ribbonTab: string;
  leftDock: string | null;
  centerDock: string | null;
  rightDock: string | null;
  bottomDock: string | null;
}

interface WorkspaceStoreState {
  currentStage: WorkspaceMode;
  stageLayouts: Record<WorkspaceMode, StageLayoutState>;
  selectionId: string | null;
  activeProjectId: string | null;
  launcherVisible: boolean;
  launchIntent: LaunchIntent | null;
  rightInspectorOpen: boolean;
  settingsOpen: boolean;
  physicsDocsOpen: boolean;
  physicsDocsTopic: string | null;
  setCurrentStage: (mode: WorkspaceMode) => void;
  setRibbonTab: (mode: WorkspaceMode, tab: string) => void;
  setLeftDock: (mode: WorkspaceMode, dock: string | null) => void;
  setCenterDock: (mode: WorkspaceMode, dock: string | null) => void;
  setRightDock: (mode: WorkspaceMode, dock: string | null) => void;
  setBottomDock: (mode: WorkspaceMode, dock: string | null) => void;
  setSelectionId: (id: string | null) => void;
  setActiveProjectId: (id: string | null) => void;
  setLauncherVisible: (visible: boolean) => void;
  setLaunchIntent: (intent: LaunchIntent | null) => void;
  setRightInspectorOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  setPhysicsDocsOpen: (open: boolean, topic?: string | null) => void;
  // compatibility aliases for legacy calls
  mode: WorkspaceMode;
  setMode: (mode: WorkspaceMode) => void;
}

function updateStageLayout(
  state: WorkspaceStoreState,
  mode: WorkspaceMode,
  patch: Partial<StageLayoutState>,
): Record<WorkspaceMode, StageLayoutState> {
  return {
    ...state.stageLayouts,
    [mode]: { ...state.stageLayouts[mode], ...patch },
  };
}

export const useWorkspaceStore = create<WorkspaceStoreState>((set, get) => ({
  currentStage: "analyze",
  stageLayouts: {
    build: {
      ribbonTab: "Home",
      leftDock: "model",
      centerDock: "settings",
      rightDock: "properties",
      bottomDock: "messages",
    },
    study: {
      ribbonTab: "Home",
      leftDock: "study-tree",
      centerDock: "viewport-controls",
      rightDock: "solver",
      bottomDock: "jobs",
    },
    analyze: {
      ribbonTab: "Home",
      leftDock: "results-tree",
      centerDock: "plots",
      rightDock: "display",
      bottomDock: "charts",
    },
  },
  selectionId: null,
  activeProjectId: null,
  launcherVisible: false,
  launchIntent: null,
  rightInspectorOpen: false,
  settingsOpen: false,
  physicsDocsOpen: false,
  physicsDocsTopic: null,
  setCurrentStage: (currentStage) => set({ currentStage, mode: currentStage }),
  setRibbonTab: (mode, ribbonTab) =>
    set((state) => ({ stageLayouts: updateStageLayout(state, mode, { ribbonTab }) })),
  setLeftDock: (mode, leftDock) =>
    set((state) => ({ stageLayouts: updateStageLayout(state, mode, { leftDock }) })),
  setCenterDock: (mode, centerDock) =>
    set((state) => ({ stageLayouts: updateStageLayout(state, mode, { centerDock }) })),
  setRightDock: (mode, rightDock) =>
    set((state) => ({ stageLayouts: updateStageLayout(state, mode, { rightDock }) })),
  setBottomDock: (mode, bottomDock) =>
    set((state) => ({ stageLayouts: updateStageLayout(state, mode, { bottomDock }) })),
  setSelectionId: (selectionId) => set({ selectionId }),
  setActiveProjectId: (activeProjectId) => set({ activeProjectId }),
  setLauncherVisible: (launcherVisible) => set({ launcherVisible }),
  setLaunchIntent: (launchIntent) => set({ launchIntent }),
  setRightInspectorOpen: (rightInspectorOpen) => set({ rightInspectorOpen }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setPhysicsDocsOpen: (physicsDocsOpen, topic = null) =>
    set((state) => ({
      physicsDocsOpen,
      physicsDocsTopic: topic !== undefined ? topic : state.physicsDocsTopic,
    })),
  mode: "analyze",
  setMode: (mode) => set({ currentStage: mode, mode }),
}));

export function useActiveStageLayout(): StageLayoutState {
  const state = useWorkspaceStore();
  return state.stageLayouts[state.currentStage];
}

