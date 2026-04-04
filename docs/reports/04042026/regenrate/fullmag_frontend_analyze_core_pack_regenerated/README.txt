Fullmag Frontend Analyze Core Pack — regenerated edition

Files:
- fullmag_frontend_analyze_core_report_pl.md
- frontend_core_analyzeSelection.ts
- frontend_core_useAnalyzeArtifacts.ts
- frontend_core_ControlRoomContext_patch.tsx
- frontend_core_RunSidebar_patch.tsx
- frontend_core_ModelTree_patch.ts
- frontend_core_AnalyzeViewport_shell.tsx

Recommended order:
1. Add shared Analyze state to ControlRoomContext.
2. Add the artifact hook.
3. Refactor AnalyzeViewport to consume hook + shared state.
4. Add tree nodes.
5. Wire RunSidebar click routing.
