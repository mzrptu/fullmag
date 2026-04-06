import type { ScriptBuilderStageState } from "@/lib/session/types";
import type { PrimitiveStageNode, StudyPipelineDocument } from "./types";

function inferPrimitiveKind(stage: ScriptBuilderStageState): PrimitiveStageNode["stage_kind"] {
  const entrypoint = String(stage.entrypoint_kind ?? "").toLowerCase();
  const kind = String(stage.kind ?? "").toLowerCase();
  if (entrypoint === "relax" || kind.includes("relax")) return "relax";
  if (entrypoint === "eigenmodes" || kind.includes("eigen")) return "eigenmodes";
  if (entrypoint === "run" || kind.includes("run")) return "run";
  return "run";
}

function importedStageLabel(stage: ScriptBuilderStageState, index: number): string {
  const originalKind = String(stage.kind ?? "").trim();
  if (originalKind.length > 0 && originalKind !== inferPrimitiveKind(stage)) {
    return `Imported ${index + 1} · ${originalKind}`;
  }
  return `Imported Stage ${index + 1}`;
}

function primitiveNodeFromStage(stage: ScriptBuilderStageState, index: number): PrimitiveStageNode {
  return {
    id: `stage_${index + 1}_${stage.kind}`,
    label: importedStageLabel(stage, index),
    enabled: true,
    source: "script_imported",
    node_kind: "primitive",
    stage_kind: inferPrimitiveKind(stage),
    payload: { ...stage },
  };
}

export function migrateFlatStagesToStudyPipeline(
  stages: ScriptBuilderStageState[],
): StudyPipelineDocument {
  return {
    version: "study_pipeline.v1",
    nodes: stages.map(primitiveNodeFromStage),
  };
}
