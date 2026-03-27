from __future__ import annotations

import json
import os
import sys


PROGRESS_PREFIX = "[fullmag-progress]"
PROGRESS_JSON_PREFIX = "json:"


def emit_progress(message: str) -> None:
    if os.environ.get("FULLMAG_PROGRESS", "").lower() not in {"1", "true", "yes", "on"}:
        return
    print(f"{PROGRESS_PREFIX} {message}", file=sys.stderr, flush=True)


def emit_progress_event(payload: dict[str, object]) -> None:
    if os.environ.get("FULLMAG_PROGRESS", "").lower() not in {"1", "true", "yes", "on"}:
        return
    print(
        f"{PROGRESS_PREFIX} {PROGRESS_JSON_PREFIX}{json.dumps(payload, separators=(',', ':'))}",
        file=sys.stderr,
        flush=True,
    )
