---
applyTo: "crates/**/*.rs"
description: "Use when editing Rust files in Fullmag. Keep Rust as the typed control plane with explicit domain models, planner seams, and stable interfaces."
---

# Rust instructions

- Prefer domain types over free-form maps and raw JSON.
- Keep crate dependencies lean; extract shared types into `fullmag-ir` before duplicating.
- Make invalid states hard to represent.
- Favor `Result`-based APIs with helpful error messages over panics.
- Keep public interfaces ready for CLI, API, and worker reuse.
