/* ── Binary preview frame decoder ──
 * Handles the FMVP binary websocket protocol for vector field payloads. */

import type { PreviewBinaryPayload, SessionState } from "./types";

const PREVIEW_BINARY_FRAME_MAGIC = "FMVP";
const PREVIEW_BINARY_FRAME_HEADER_LEN = 16;
const PREVIEW_BINARY_FRAME_KIND_F64 = 1;

export function decodePreviewBinaryFrame(data: ArrayBuffer): PreviewBinaryPayload | null {
  if (data.byteLength < PREVIEW_BINARY_FRAME_HEADER_LEN) {
    return null;
  }

  const view = new DataView(data);
  const magic = String.fromCharCode(
    view.getUint8(0),
    view.getUint8(1),
    view.getUint8(2),
    view.getUint8(3),
  );
  if (magic !== PREVIEW_BINARY_FRAME_MAGIC) {
    return null;
  }

  const version = view.getUint8(4);
  const kind = view.getUint8(5);
  if (version !== 1 || kind !== PREVIEW_BINARY_FRAME_KIND_F64) {
    return null;
  }

  const payloadId = view.getUint32(8, true);
  const elementCount = view.getUint32(12, true);
  const expectedLength = PREVIEW_BINARY_FRAME_HEADER_LEN + elementCount * 8;
  if (data.byteLength !== expectedLength) {
    return null;
  }

  return {
    payloadId,
    vectorFieldValues: new Float64Array(data, PREVIEW_BINARY_FRAME_HEADER_LEN, elementCount),
  };
}

export function attachPreviewBinaryPayload(
  prev: SessionState | null,
  payloadId: number,
  vectorFieldValues: Float64Array,
): SessionState | null {
  if (!prev || !prev.preview || prev.preview.kind !== "spatial") {
    return prev;
  }
  if (prev.preview.vector_payload_id !== payloadId) {
    return prev;
  }
  if (prev.preview.vector_field_values === vectorFieldValues) {
    return prev;
  }
  return {
    ...prev,
    preview: {
      ...prev.preview,
      vector_field_values: vectorFieldValues,
    },
  };
}
