// @ts-nocheck
import { describe, expect, it } from "vitest";

import { buildWorkspaceHref, parseWorkspaceRoute } from "../parseWorkspaceRoute";

describe("parseWorkspaceRoute", () => {
  it("parses known workspace stage from pathname", () => {
    const parsed = parseWorkspaceRoute("/study");
    expect(parsed).toEqual({
      stage: "study",
      projectId: null,
      runId: null,
      selectionId: null,
    });
  });

  it("returns null for unknown route", () => {
    expect(parseWorkspaceRoute("/settings")).toBeNull();
  });
});

describe("buildWorkspaceHref", () => {
  it("builds stage route with optional params", () => {
    expect(
      buildWorkspaceHref({
        stage: "analyze",
        projectId: "p-1",
        runId: "r-2",
      }),
    ).toBe("/analyze?projectId=p-1&runId=r-2");
  });
});
