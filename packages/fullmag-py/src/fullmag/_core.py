"""Private bridge to optional native helpers.

The public API remains pure Python. Native helpers stay internal and optional
until packaging for the PyO3 bridge is finalized.
"""

from __future__ import annotations

import json
from typing import Any

try:
    import _fullmag_core as _native_core
except ImportError:  # pragma: no cover - optional bootstrap dependency
    _native_core = None


def validate_ir(ir: dict[str, Any]) -> bool | None:
    if _native_core is None:
        return None
    return bool(_native_core.validate_ir_json(json.dumps(ir)))
