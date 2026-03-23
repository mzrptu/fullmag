#!/usr/bin/env python3
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

ACTIVE_TEXT_FILES = [
    ROOT / "AGENTS.md",
    ROOT / "readme.md",
    ROOT / "docs",
    ROOT / "apps" / "web" / "app" / "page.tsx",
    ROOT / "crates" / "fullmag-cli" / "src" / "main.rs",
    ROOT / ".agents",
    ROOT / ".github",
]

STALE_TERMS = ("physics-first DSL", "text DSL", "parser version", "parser seam")


def iter_files(paths: list[Path]) -> list[Path]:
    files: list[Path] = []
    for path in paths:
        if path.is_file():
            files.append(path)
            continue
        for child in path.rglob("*"):
            if child.is_file() and child.suffix in {".md", ".ts", ".tsx", ".rs"}:
                files.append(child)
    return files


def check_stale_language(files: list[Path]) -> list[str]:
    failures: list[str] = []
    for file_path in files:
        text = file_path.read_text(encoding="utf-8")
        for token in STALE_TERMS:
            if token in text:
                failures.append(f"stale term '{token}' found in {file_path.relative_to(ROOT)}")
        if "parser" in text and "Python parser" not in text and file_path.relative_to(ROOT) != Path("scientific_papers"):
            if "parser" in text:
                failures.append(f"unexpected 'parser' reference found in {file_path.relative_to(ROOT)}")
    return failures


def check_physics_template() -> list[str]:
    failures: list[str] = []
    canonical_template = ROOT / "docs" / "physics" / "TEMPLATE.md"
    legacy_template = ROOT / ".agents" / "skills" / "physics-publication" / "templates" / "physics-note.md"
    if not canonical_template.exists():
        failures.append("missing canonical docs/physics/TEMPLATE.md")
    if legacy_template.exists():
        failures.append("legacy .agents physics template still exists; docs/physics/TEMPLATE.md must be canonical")
    return failures


def check_skill_mirror() -> list[str]:
    failures: list[str] = []
    agent_skills = {path.name for path in (ROOT / ".agents" / "skills").iterdir() if path.is_dir()}
    github_skills = {path.name for path in (ROOT / ".github" / "skills").iterdir() if path.is_dir()}
    missing = sorted(agent_skills - github_skills)
    if missing:
        failures.append(f".github is missing skill mirrors for: {', '.join(missing)}")
    return failures


def main() -> int:
    files = iter_files(ACTIVE_TEXT_FILES)
    failures = [
        *check_stale_language(files),
        *check_physics_template(),
        *check_skill_mirror(),
    ]
    if failures:
        for failure in failures:
            print(f"FAIL: {failure}")
        return 1
    print("Repository consistency checks passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
