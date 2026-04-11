export { useAuthoringStore, selectSceneDraft, selectModelBuilderGraph, selectSyncStatus, selectIsDirty, selectSelectedObjectId, selectSelectedEntityId, selectFocusedEntityId, selectMeshEntityViewState, selectValidationErrors } from "./store/useAuthoringStore";
export type { AuthoringState, DraftSyncStatus, DraftValidationError } from "./model/sceneDraft.types";
export { DraftSyncController } from "./sync/DraftSyncController";
export type { DraftCommitEntry, DraftSyncCallbacks, DraftSyncApi } from "./sync/DraftSyncController";
export { remoteSceneToDraft } from "./adapters/remoteSceneToDraft";
export { draftSignature, draftsEqual } from "./adapters/draftToSceneDocument";
export { draftToModelTree } from "./adapters/draftToModelTree";
export type { ModelTreeNode } from "./adapters/draftToModelTree";
export * from "./commands/index";
