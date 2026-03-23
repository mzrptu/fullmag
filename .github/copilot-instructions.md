# Copilot instructions for Fullmag

- Treat `docs/1_project_scope.md`, `docs/specs/problem-ir-v0.md`, `docs/physics/`, and the ADRs as the canonical architecture and physics reference.
- The only public authoring surface is the embedded Python DSL in `packages/fullmag-py`.
- Python builds `ProblemIR`; Rust validates, normalizes, and plans it.
- The shared API must describe physics, not grid internals or FEM-only implementation details.
- Before implementing any physics or numerics feature, create or update a publication-style note in `docs/physics/`.
- Use `docs/physics/TEMPLATE.md` as the canonical template.
- Assume container-first verification through `docker compose` and `Makefile`.
