---
applyTo: "**"
description: "Use when working anywhere in Fullmag to preserve the physics-first interface, mandatory docs/physics documentation, strict/extended/hybrid modes, Rust control plane, C ABI backend boundary, and container-first workflow."
---

# Architecture instructions

- Prefer changes that strengthen the canonical `ProblemIR` and planner boundary.
- Treat `docs/physics/` as mandatory pre-implementation documentation for any physics or numerical feature.
- Never introduce common-layer APIs that depend on Cartesian cell indices or FEM implementation details.
- If a feature is backend-specific, surface it through capability checks or an explicit `extended` mode.
- Keep provenance and reproducibility in mind: parser version, backend revision, solver settings, and runtime environment should remain first-class metadata.
- A physics feature is not ready if its equations, assumptions, units, and validation strategy are not documented.
- When in doubt, update or add an ADR before expanding implementation scope.
