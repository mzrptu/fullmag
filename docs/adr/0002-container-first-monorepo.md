# ADR 0002: Container-first monorepo

- Status: accepted
- Date: 2026-03-23

## Context

The project spans Rust, TypeScript, C++, CUDA, storage services, and future HPC integrations. Local machine setup would quickly become inconsistent and expensive to support.

## Decision

Fullmag uses a monorepo with container-first development. The repository contains the control plane, web app, native backends, interface definitions, and architecture docs. Local development and verification should run through containerized workflows by default.

## Consequences

- One repository owns architecture, contracts, and bootstrap tooling.
- `docker compose` and repo-level commands are first-class developer entry points.
- Native backend spikes can evolve behind clear directories and build seams without polluting host environments.
- CI can mirror the same containerized assumptions over time.
