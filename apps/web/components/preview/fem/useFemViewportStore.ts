"use client";

import { useMemo, useReducer } from "react";
import type { FemColorField, RenderMode, ClipAxis } from "../FemMeshView3D";
import type {
  FemViewportNavigation,
  FemViewportProjection,
  FemViewportStoreState,
} from "./FemViewportTypes";
import type { ViewportQualityProfileId } from "../shared/viewportQualityProfiles";

type Action =
  | { type: "setRenderMode"; value: RenderMode }
  | { type: "setSurfaceColorField"; value: FemColorField }
  | { type: "setArrowColorField"; value: FemColorField }
  | { type: "setProjection"; value: FemViewportProjection }
  | { type: "setNavigation"; value: FemViewportNavigation }
  | { type: "setClipEnabled"; value: boolean }
  | { type: "setClipAxis"; value: ClipAxis }
  | { type: "setClipPosition"; value: number }
  | { type: "setArrowsVisible"; value: boolean }
  | { type: "setQualityProfile"; value: ViewportQualityProfileId }
  | { type: "setPartExplorerOpen"; value: boolean }
  | { type: "setLegendOpen"; value: boolean }
  | { type: "setLabeledMode"; value: boolean }
  | { type: "setSelectedFaces"; value: number[] }
  | { type: "setHoveredFaceIndex"; value: number | null }
  | { type: "resetSelection" };

const INITIAL_STATE: FemViewportStoreState = {
  toolbar: {
    renderMode: "surface+edges",
    surfaceColorField: "orientation",
    arrowColorField: "orientation",
    projection: "perspective",
    navigation: "trackball",
    clip: {
      enabled: false,
      axis: "x",
      position: 50,
    },
    arrowsVisible: false,
    qualityProfile: "interactive",
    partExplorerOpen: true,
    legendOpen: true,
    labeledMode: false,
  },
  selection: {
    selectedFaceIndices: [],
    hoveredFaceIndex: null,
  },
};

function reducer(state: FemViewportStoreState, action: Action): FemViewportStoreState {
  switch (action.type) {
    case "setRenderMode":
      return { ...state, toolbar: { ...state.toolbar, renderMode: action.value } };
    case "setSurfaceColorField":
      return { ...state, toolbar: { ...state.toolbar, surfaceColorField: action.value } };
    case "setArrowColorField":
      return { ...state, toolbar: { ...state.toolbar, arrowColorField: action.value } };
    case "setProjection":
      return { ...state, toolbar: { ...state.toolbar, projection: action.value } };
    case "setNavigation":
      return { ...state, toolbar: { ...state.toolbar, navigation: action.value } };
    case "setClipEnabled":
      return {
        ...state,
        toolbar: { ...state.toolbar, clip: { ...state.toolbar.clip, enabled: action.value } },
      };
    case "setClipAxis":
      return {
        ...state,
        toolbar: { ...state.toolbar, clip: { ...state.toolbar.clip, axis: action.value } },
      };
    case "setClipPosition":
      return {
        ...state,
        toolbar: { ...state.toolbar, clip: { ...state.toolbar.clip, position: action.value } },
      };
    case "setArrowsVisible":
      return { ...state, toolbar: { ...state.toolbar, arrowsVisible: action.value } };
    case "setQualityProfile":
      return { ...state, toolbar: { ...state.toolbar, qualityProfile: action.value } };
    case "setPartExplorerOpen":
      return { ...state, toolbar: { ...state.toolbar, partExplorerOpen: action.value } };
    case "setLegendOpen":
      return { ...state, toolbar: { ...state.toolbar, legendOpen: action.value } };
    case "setLabeledMode":
      return { ...state, toolbar: { ...state.toolbar, labeledMode: action.value } };
    case "setSelectedFaces":
      return { ...state, selection: { ...state.selection, selectedFaceIndices: action.value } };
    case "setHoveredFaceIndex":
      return { ...state, selection: { ...state.selection, hoveredFaceIndex: action.value } };
    case "resetSelection":
      return {
        ...state,
        selection: {
          selectedFaceIndices: [],
          hoveredFaceIndex: null,
        },
      };
    default:
      return state;
  }
}

export function useFemViewportStore(initial?: Partial<FemViewportStoreState>) {
  const hydrated = useMemo<FemViewportStoreState>(() => {
    if (!initial) {
      return INITIAL_STATE;
    }
    return {
      toolbar: {
        ...INITIAL_STATE.toolbar,
        ...(initial.toolbar ?? {}),
        clip: {
          ...INITIAL_STATE.toolbar.clip,
          ...(initial.toolbar?.clip ?? {}),
        },
      },
      selection: {
        ...INITIAL_STATE.selection,
        ...(initial.selection ?? {}),
      },
    };
  }, [initial]);

  const [state, dispatch] = useReducer(reducer, hydrated);

  return { state, dispatch };
}
