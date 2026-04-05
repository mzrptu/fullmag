import { create } from "zustand";

export type WorkspaceMode = "build" | "study" | "analyze" | "runs";

interface WorkspaceStoreState {
  mode: WorkspaceMode;
  ribbonTabByMode: Record<WorkspaceMode, string>;
  leftDockByMode: Record<WorkspaceMode, string | null>;
  rightDockByMode: Record<WorkspaceMode, string | null>;
  bottomDockByMode: Record<WorkspaceMode, string | null>;
  selectionId: string | null;
  activeProjectId: string | null;

  /** Whether the right inspector dock is pinned open */
  rightInspectorOpen: boolean;

  /** Whether the settings dialog is open */
  settingsOpen: boolean;

  /** Whether the physics docs drawer is open */
  physicsDocsOpen: boolean;

  /** Topic to show in physics docs drawer */
  physicsDocsTopic: string | null;

  setMode: (mode: WorkspaceMode) => void;
  setRibbonTab: (mode: WorkspaceMode, tab: string) => void;
  setLeftDock: (mode: WorkspaceMode, dock: string | null) => void;
  setRightDock: (mode: WorkspaceMode, dock: string | null) => void;
  setSelectionId: (id: string | null) => void;
  setActiveProjectId: (id: string | null) => void;
  setRightInspectorOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  setPhysicsDocsOpen: (open: boolean, topic?: string | null) => void;
}

export const useWorkspaceStore = create<WorkspaceStoreState>((set) => ({
  mode: "analyze",
  ribbonTabByMode: {
    build: "Home",
    study: "Home",
    analyze: "Results",
    runs: "Home",
  },
  leftDockByMode: {
    build: "model",
    study: "study-tree",
    analyze: "results-tree",
    runs: "queue",
  },
  rightDockByMode: {
    build: "properties",
    study: "solver",
    analyze: "display",
    runs: "details",
  },
  bottomDockByMode: {
    build: "validation",
    study: "validation",
    analyze: "console",
    runs: "logs",
  },
  selectionId: null,
  activeProjectId: null,
  rightInspectorOpen: false,
  settingsOpen: false,
  physicsDocsOpen: false,
  physicsDocsTopic: null,

  setMode: (mode) => set({ mode }),
  setRibbonTab: (mode, tab) =>
    set((state) => ({
      ribbonTabByMode: { ...state.ribbonTabByMode, [mode]: tab },
    })),
  setLeftDock: (mode, dock) =>
    set((state) => ({
      leftDockByMode: { ...state.leftDockByMode, [mode]: dock },
    })),
  setRightDock: (mode, dock) =>
    set((state) => ({
      rightDockByMode: { ...state.rightDockByMode, [mode]: dock },
    })),
  setSelectionId: (selectionId) => set({ selectionId }),
  setActiveProjectId: (activeProjectId) => set({ activeProjectId }),
  setRightInspectorOpen: (rightInspectorOpen) => set({ rightInspectorOpen }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setPhysicsDocsOpen: (physicsDocsOpen, topic = null) =>
    set((state) => ({
      physicsDocsOpen,
      physicsDocsTopic: topic !== undefined ? topic : state.physicsDocsTopic,
    })),
}));
