import { humanizeToken } from "@/components/panels/settings/helpers";
import type { ScriptBuilderStageState } from "@/lib/session/types";
import type { StudyPipelineNode } from "./types";

export function humanizeStudyPipelineNodeKind(node: StudyPipelineNode): string {
  if (node.node_kind === "primitive") {
    return humanizeToken(node.stage_kind);
  }
  if (node.node_kind === "macro") {
    if (node.macro_kind === "field_sweep_relax") return "Field Sweep + Relax";
    if (node.macro_kind === "relax_run") return "Relax -> Run";
    if (node.macro_kind === "relax_eigenmodes") return "Relax -> Eigenmodes";
    return humanizeToken(node.macro_kind);
  }
  return "Stage Group";
}

export function summarizeStudyPipelineNode(node: StudyPipelineNode): string {
  if (node.node_kind === "primitive") {
    const originalKind =
      typeof node.payload.kind === "string" && node.payload.kind.length > 0
        ? node.payload.kind
        : node.stage_kind;
    if (node.source === "script_imported" && originalKind !== node.stage_kind) {
      return `${node.stage_kind} · imported from ${originalKind}`;
    }
    return node.stage_kind;
  }
  if (node.node_kind === "macro") {
    if (node.macro_kind === "field_sweep_relax") {
      const start = Number(node.config.start_mT ?? -100);
      const stop = Number(node.config.stop_mT ?? 100);
      const steps = Math.max(1, Number(node.config.steps ?? 11));
      return `field sweep ${start} -> ${stop} mT (${steps} steps) + relax`;
    }
    if (node.macro_kind === "relax_run") return "relax then run";
    if (node.macro_kind === "relax_eigenmodes") return "relax then eigenmodes";
    return node.macro_kind;
  }
  return `group · ${node.children.length} nodes`;
}

export function summarizeMaterializedStage(stage: ScriptBuilderStageState): string {
  if (stage.kind === "relax") {
    return [
      stage.relax_algorithm ? humanizeToken(stage.relax_algorithm) : null,
      stage.max_steps ? `${stage.max_steps} steps` : null,
      stage.torque_tolerance ? `tol ${stage.torque_tolerance}` : null,
    ].filter(Boolean).join(" · ");
  }
  if (stage.kind === "run") {
    return [
      stage.until_seconds ? `until ${stage.until_seconds} s` : "time evolution",
      stage.fixed_timestep ? `dt ${stage.fixed_timestep}` : null,
      stage.integrator ? humanizeToken(stage.integrator) : null,
    ].filter(Boolean).join(" · ");
  }
  if (stage.kind === "eigenmodes") {
    return [
      stage.eigen_count ? `${stage.eigen_count} modes` : null,
      stage.eigen_target ? humanizeToken(stage.eigen_target) : null,
      stage.eigen_include_demag ? "demag on" : null,
    ].filter(Boolean).join(" · ");
  }
  return stage.entrypoint_kind ? humanizeToken(stage.entrypoint_kind) : "backend stage";
}
