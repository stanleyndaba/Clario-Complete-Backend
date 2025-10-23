"""
Python startup hook to patch Pydantic v1 for Python 3.13 on Render.

This is imported automatically by Python after the "site" module loads
if present on sys.path (PEP 370). It ensures the ForwardRef evaluation
signature change in Python 3.13 doesn't break Pydantic v1.

No-op for Pydantic v2 or Python < 3.13.
"""
from __future__ import annotations

import sys
import typing

try:
    import pydantic
except Exception:
    # If pydantic isn't available at startup, nothing to do.
    pydantic = None  # type: ignore


def _is_py313_or_newer() -> bool:
    try:
        major, minor = sys.version_info[:2]
        return (major, minor) >= (3, 13)
    except Exception:
        return False


def _pydantic_major() -> int:
    if not pydantic:
        return 0
    try:
        return int(str(getattr(pydantic, "__version__", "1")).split(".")[0])
    except Exception:
        return 1


def _patch_pydantic_v1_forwardref() -> None:
    if not _is_py313_or_newer():
        return
    if not pydantic:
        return
    try:
        import pydantic.typing as pyd_typing  # type: ignore
    except Exception:
        return

    original = getattr(pyd_typing, "evaluate_forwardref", None)
    ForwardRef = getattr(typing, "ForwardRef", None)
    if not callable(original) or ForwardRef is None:
        return

    def _patched(type_, globalns, localns):  # type: ignore
        try:
            if isinstance(type_, ForwardRef):
                return type_._evaluate(globalns=globalns, localns=localns, recursive_guard=set())
        except TypeError:
            return type_._evaluate(globalns, localns, set())
        return original(type_, globalns, localns)

    try:
        pyd_typing.evaluate_forwardref = _patched  # type: ignore[attr-defined]
    except Exception:
        pass


if _pydantic_major() == 1:
    _patch_pydantic_v1_forwardref()
