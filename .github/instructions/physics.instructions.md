---
applyTo: "**"
description: "Use when implementing or discussing any physics, numerics, backend term, validation, mesh logic, or solver feature in Fullmag. docs/physics documentation is mandatory before coding."
---

# Physics-first implementation instructions

- Before implementing a physics or numerical feature, ensure there is a corresponding document in `docs/physics/`.
- The document must describe equations, symbols, units, assumptions, backend interpretation, planner impact, and validation strategy.
- If the feature touches FDM, FEM, and hybrid semantics differently, those differences must be written down explicitly.
- Missing physics documentation is a blocker, not a nice-to-have.
- After implementation, update the same document with validation status, open limits, and deferred work.
