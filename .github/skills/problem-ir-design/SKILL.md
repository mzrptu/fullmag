---
name: problem-ir-design
description: "Use when designing or refining Fullmag ProblemIR, validation semantics, planner inputs, capability matrix fields, or strict/extended/hybrid execution behavior."
---

# Problem IR design

This skill exists to keep the canonical model coherent.

## Principles

- Encode physical intent, not backend implementation detail.
- Separate user syntax (DSL/JSON/UI) from normalized IR.
- Make planner decisions explicit in downstream execution plans.
- Preserve provenance needed for scientific reproducibility.

## Minimum outputs

- proposed IR types,
- validation rules,
- capability touchpoints,
- serialization and versioning notes,
- open questions for later ADRs.
