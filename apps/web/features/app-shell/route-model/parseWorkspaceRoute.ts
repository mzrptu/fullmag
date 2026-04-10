import type { WorkspaceStage, WorkspaceRouteParams } from "./workspaceRoute.types";

const STAGE_SEGMENTS: Record<string, WorkspaceStage> = {
  build: "build",
  study: "study",
  analyze: "analyze",
};

/**
 * Extract workspace route parameters from a pathname.
 * This is a pure function — no side-effects.
 */
export function parseWorkspaceRoute(pathname: string): WorkspaceRouteParams | null {
  const segments = pathname.split("/").filter(Boolean);
  const stageSegment = segments[0];

  if (!stageSegment || !(stageSegment in STAGE_SEGMENTS)) {
    return null;
  }

  return {
    stage: STAGE_SEGMENTS[stageSegment],
    projectId: getSearchParam("projectId"),
    runId: getSearchParam("runId"),
    selectionId: getSearchParam("selectionId"),
  };
}

function getSearchParam(key: string): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(key);
}

/**
 * Build a workspace href from route params.
 */
export function buildWorkspaceHref(params: {
  stage: WorkspaceStage;
  projectId?: string | null;
  runId?: string | null;
}): string {
  const base = `/${params.stage}`;
  const searchParams = new URLSearchParams();
  if (params.projectId) searchParams.set("projectId", params.projectId);
  if (params.runId) searchParams.set("runId", params.runId);
  const qs = searchParams.toString();
  return qs ? `${base}?${qs}` : base;
}
