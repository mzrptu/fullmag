import { create } from "zustand";
import type { LaunchIntent } from "./launch-intent";

export type WorkspaceMode = "build" | "study" | "analyze";
export type RightInspectorTab = "selected-submeshes" | "tools";

interface StageLayoutState {
  leftDock: string | null;
  centerDock: string | null;
  rightDock: string | null;
  bottomDock: string | null;
}

interface WorkspaceStoreState {
  currentStage: WorkspaceMode;
  activeCoreTab: string;
  activeContextualTab: string | null;
  stageLayouts: Record<WorkspaceMode, StageLayoutState>;
  selectionId: string | null;
  activeProjectId: string | null;
  launcherVisible: boolean;
  launchIntent: LaunchIntent | null;
  rightInspectorOpen: boolean;
  rightInspectorTab: RightInspectorTab;
  settingsOpen: boolean;
  physicsDocsOpen: boolean;
  physicsDocsTopic: string | null;
  setCurrentStage: (mode: WorkspaceMode) => void;
  setActiveCoreTab: (tab: string) => void;
  setActiveContextualTab: (tab: string | null) => void;
  setLeftDock: (mode: WorkspaceMode, dock: string | null) => void;
  setCenterDock: (mode: WorkspaceMode, dock: string | null) => void;
  setRightDock: (mode: WorkspaceMode, dock: string | null) => void;
  setBottomDock: (mode: WorkspaceMode, dock: string | null) => void;
  setSelectionId: (id: string | null) => void;
  setActiveProjectId: (id: string | null) => void;
  setLauncherVisible: (visible: boolean) => void;
  setLaunchIntent: (intent: LaunchIntent | null) => void;
  setRightInspectorOpen: (open: boolean) => void;
  setRightInspectorTab: (tab: RightInspectorTab) => void;
  setSettingsOpen: (open: boolean) => void;
  setPhysicsDocsOpen: (open: boolean, topic?: string | null) => void;
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

export const useWorkspaceStore = create<WorkspaceStoreState>((set) => ({
  currentStage: "analyze",
  activeCoreTab: "Home",
  activeContextualTab: null,
  stageLayouts: {
    build: {
      leftDock: "model",
      centerDock: "settings",
      rightDock: "properties",
      bottomDock: "messages",
    },
    study: {
      leftDock: "study-tree",
      centerDock: "viewport-controls",
      rightDock: "solver",
      bottomDock: "jobs",
    },
    analyze: {
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
  rightInspectorTab: "selected-submeshes",
  settingsOpen: false,
  physicsDocsOpen: false,
  physicsDocsTopic: null,
  setCurrentStage: (currentStage) => set({ currentStage }),
  setActiveCoreTab: (activeCoreTab) => set({ activeCoreTab }),
  setActiveContextualTab: (activeContextualTab) => set({ activeContextualTab }),
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
  setRightInspectorTab: (rightInspectorTab) => set({ rightInspectorTab }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setPhysicsDocsOpen: (physicsDocsOpen, topic = null) =>
    set((state) => ({
      physicsDocsOpen,
      physicsDocsTopic: topic !== undefined ? topic : state.physicsDocsTopic,
    })),
}));

export function useActiveStageLayout(): StageLayoutState {
  return useWorkspaceStore((state) => state.stageLayouts[state.currentStage]);
}
