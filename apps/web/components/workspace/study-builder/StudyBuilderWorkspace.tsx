"use client";

import { useEffect, useMemo, useState } from "react";
import type { ScriptBuilderStageState, StudyPipelineDocumentState } from "@/lib/session/types";
import type {
  MaterializedStageMapEntry,
  StudyPipelineDocument,
  StudyPipelineNode,
  StudyPrimitiveStageKind,
} from "@/lib/study-builder/types";
import { migrateFlatStagesToStudyPipeline } from "@/lib/study-builder/migrate";
import { materializeStudyPipeline } from "@/lib/study-builder/materialize";
import { buildExecutionMapStatus } from "@/lib/study-builder/execution-map";
import {
  appendNode,
  createMacroNode,
  createPrimitiveNode,
  deleteNode,
  duplicateNode,
  findNodeById,
  insertNodeNear,
  patchNode,
  patchNodeConfig,
  toggleNodeEnabled,
} from "@/lib/study-builder/operations";
import StageBuilderRibbon from "./StageBuilderRibbon";
import PipelineCanvas from "./PipelineCanvas";
import StageInspector from "./StageInspector";
import ValidationPanel from "./ValidationPanel";
import ExecutionStatusPanel from "./ExecutionStatusPanel";
import MaterializedStagesPanel from "./MaterializedStagesPanel";

function findMaterializedEntry(
  entries: MaterializedStageMapEntry[],
  nodeId: string | null,
): MaterializedStageMapEntry | null {
  if (!nodeId) return null;
  for (const entry of entries) {
    if (entry.nodeId === nodeId) return entry;
    if (entry.childEntries?.length) {
      const child = findMaterializedEntry(entry.childEntries, nodeId);
      if (child) return child;
    }
  }
  return null;
}

interface StudyBuilderWorkspaceProps {
  stages: ScriptBuilderStageState[];
  pipeline: StudyPipelineDocumentState | null;
  activeStageIndex: number | null;
  completedStageCount: number;
  onChangeStages: (next: ScriptBuilderStageState[]) => void;
  onChangePipeline: (next: StudyPipelineDocumentState | null) => void;
}

function reorder(nodes: StudyPipelineNode[], nodeId: string, delta: -1 | 1): StudyPipelineNode[] {
  const index = nodes.findIndex((node) => node.id === nodeId);
  if (index < 0) return nodes;
  const target = index + delta;
  if (target < 0 || target >= nodes.length) return nodes;
  const next = [...nodes];
  const [node] = next.splice(index, 1);
  next.splice(target, 0, node);
  return next;
}

export default function StudyBuilderWorkspace({
  stages,
  pipeline,
  activeStageIndex,
  completedStageCount,
  onChangeStages,
  onChangePipeline,
}: StudyBuilderWorkspaceProps) {
  const [document, setDocument] = useState<StudyPipelineDocument>(() =>
    (pipeline as StudyPipelineDocument | null) ?? migrateFlatStagesToStudyPipeline(stages),
  );
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  // Sync document state with pipeline/stages props during render (React 19 recommended pattern for resets)
  const [prevPipeline, setPrevPipeline] = useState(pipeline);
  const [prevStages, setPrevStages] = useState(stages);

  if (pipeline !== prevPipeline || stages !== prevStages) {
    setPrevPipeline(pipeline);
    setPrevStages(stages);
    setDocument((pipeline as StudyPipelineDocument | null) ?? migrateFlatStagesToStudyPipeline(stages));
  }

  // Derive selection validity during render to avoid secondary effects
  const nodeExists = selectedNodeId ? findNodeById(document.nodes, selectedNodeId) : null;
  const effectiveSelectedNodeId = nodeExists ? selectedNodeId : null;

  const materialized = useMemo(() => materializeStudyPipeline(document), [document]);
  const selectedNode = useMemo(
    () => findNodeById(document.nodes, selectedNodeId ?? "") ?? null,
    [document.nodes, selectedNodeId],
  );
  const executionEntries = useMemo(
    () => buildExecutionMapStatus(materialized.map, activeStageIndex, completedStageCount),
    [activeStageIndex, completedStageCount, materialized.map],
  );
  const selectedMaterializedEntry = useMemo(
    () => findMaterializedEntry(materialized.map, selectedNodeId),
    [materialized.map, selectedNodeId],
  );
  const selectedCompiledStages = useMemo(
    () =>
      selectedMaterializedEntry
        ? selectedMaterializedEntry.stageIndexes.map((index) => materialized.stages[index]).filter(Boolean)
        : [],
    [materialized.stages, selectedMaterializedEntry],
  );
  const selectedDiagnostics = useMemo(
    () => materialized.diagnostics.filter((item) => item.nodeId === selectedNodeId),
    [materialized.diagnostics, selectedNodeId],
  );

  const commit = (next: StudyPipelineDocument) => {
    setDocument(next);
    const materialized = materializeStudyPipeline(next);
    onChangeStages(materialized.stages);
    onChangePipeline(next);
  };

  const placePrimitive = (
    kind: StudyPrimitiveStageKind,
    placement: "append" | "before" | "after",
  ) => {
    if (!selectedNodeId || placement === "append") {
      commit(appendNode(document, createPrimitiveNode(kind)));
      return;
    }
    commit(insertNodeNear(document, selectedNodeId, placement, createPrimitiveNode(kind)));
  };

  const placeMacro = (
    kind: "field_sweep_relax" | "relax_run" | "relax_eigenmodes",
    placement: "append" | "before" | "after",
  ) => {
    if (!selectedNodeId || placement === "append") {
      commit(appendNode(document, createMacroNode(kind)));
      return;
    }
    commit(insertNodeNear(document, selectedNodeId, placement, createMacroNode(kind)));
  };

  return (
    <div className="flex flex-col gap-3">
      <StageBuilderRibbon
        onAddPrimitive={placePrimitive}
        onAddMacro={placeMacro}
        selectedNodeId={selectedNodeId}
        onDuplicateSelected={() => (selectedNodeId ? commit(duplicateNode(document, selectedNodeId)) : null)}
        onToggleSelectedEnabled={() =>
          selectedNodeId ? commit(toggleNodeEnabled(document, selectedNodeId)) : null
        }
      />
      <div className="grid grid-cols-1 gap-3 2xl:grid-cols-[minmax(0,1.2fr)_minmax(24rem,0.9fr)]">
        <div className="min-w-0">
          <PipelineCanvas
            nodes={document.nodes}
            selectedNodeId={selectedNodeId}
            onSelectNode={setSelectedNodeId}
            onMoveUp={(nodeId) => commit({ ...document, nodes: reorder(document.nodes, nodeId, -1) })}
            onMoveDown={(nodeId) => commit({ ...document, nodes: reorder(document.nodes, nodeId, 1) })}
            onDelete={(nodeId) => commit(deleteNode(document, nodeId))}
            onDuplicate={(nodeId) => commit(duplicateNode(document, nodeId))}
            onToggleEnabled={(nodeId) => commit(toggleNodeEnabled(document, nodeId))}
            onInsertBeforeRun={(nodeId) =>
              commit(insertNodeNear(document, nodeId, "before", createPrimitiveNode("run")))
            }
            onInsertAfterRun={(nodeId) =>
              commit(insertNodeNear(document, nodeId, "after", createPrimitiveNode("run")))
            }
          />
        </div>
        <div className="flex flex-col gap-3">
          <StageInspector
            node={selectedNode}
            onRename={(value) => {
              if (!selectedNodeId) return;
              commit(patchNode(document, selectedNodeId, { label: value }));
            }}
            onToggleEnabled={() => {
              if (!selectedNodeId) return;
              commit(toggleNodeEnabled(document, selectedNodeId));
            }}
            onPatchConfig={(patch) => {
              if (!selectedNodeId) return;
              commit(patchNodeConfig(document, selectedNodeId, patch));
            }}
            onPatchNotes={(value) => {
              if (!selectedNodeId) return;
              commit(patchNode(document, selectedNodeId, { notes: value }));
            }}
            compiledStages={selectedCompiledStages}
            diagnostics={selectedDiagnostics}
          />
          <ValidationPanel diagnostics={materialized.diagnostics} />
          <MaterializedStagesPanel stages={materialized.stages} />
          <ExecutionStatusPanel entries={executionEntries} />
        </div>
      </div>
    </div>
  );
}
