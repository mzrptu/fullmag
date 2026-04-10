/**
 * Layer A: App Shell – Route Model
 *
 * URL is the SINGLE source of truth for the active workspace stage.
 * Nothing else sets stage. No store, no context, no side-effect.
 */

export type WorkspaceStage = "build" | "study" | "analyze";

export interface WorkspaceRouteParams {
  stage: WorkspaceStage;
  projectId: string | null;
  runId: string | null;
  selectionId: string | null;
}
