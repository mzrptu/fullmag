# Fullmag agent runtime assets

`.agents/` is the canonical source for Fullmag workflows and skills.

## Primary rule

Any physics-facing work must pass the `physics-first-gate` workflow before implementation.

## Build and run rule

When a repository-level `justfile` recipe exists for a build/run/package task, agents should use it
as the default entrypoint instead of inventing lower-level command sequences.

## Structure

- `skills/` — canonical agent skills
- `workflows/` — canonical agent workflows

`.github/` mirrors these rules for GitHub and Copilot entrypoints.
