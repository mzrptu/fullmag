import type { FemLiveMesh } from "./types";

export function validateFemMeshPayload(mesh: FemLiveMesh): string[] {
  const errors: string[] = [];

  if (mesh.element_markers && mesh.element_markers.length !== mesh.elements.length) {
    errors.push(
      `element_markers length (${mesh.element_markers.length}) != elements length (${mesh.elements.length})`,
    );
  }
  if (mesh.boundary_markers && mesh.boundary_markers.length !== mesh.boundary_faces.length) {
    errors.push(
      `boundary_markers length (${mesh.boundary_markers.length}) != boundary_faces length (${mesh.boundary_faces.length})`,
    );
  }
  for (const part of mesh.mesh_parts ?? []) {
    if (part.element_start + part.element_count > mesh.elements.length) {
      errors.push(`part ${part.id} element range exceeds mesh`);
    }
    if (part.boundary_face_start + part.boundary_face_count > mesh.boundary_faces.length) {
      errors.push(`part ${part.id} boundary_face range exceeds mesh`);
    }
    if (part.node_start + part.node_count > mesh.nodes.length) {
      errors.push(`part ${part.id} node range exceeds mesh`);
    }
  }

  return errors;
}
