"""
Compatibility shims for FastAPI/Pydantic across Python versions.

Purpose
-------
Render currently runs Python 3.13 by default which breaks Pydantic v1's
usage of typing.ForwardRef due to a signature change in Python 3.13.
This module applies a safe runtime monkey patch when Pydantic v1 is
detected to keep FastAPI imports working without requiring a library
upgrade. No changes are applied for Pydantic v2.

Behavior
--------
- If Pydantic v1: patch pydantic.typing.evaluate_forwardref to call
  ForwardRef._evaluate with the required "recursive_guard" kwarg on
  Python 3.13+.
- If Pydantic v2: do nothing.

This file must be importable on both v1 and v2 without ImportError.
"""

from __future__ import annotations

import sys
import typing

import pydantic


def _is_py313_or_newer() -> bool:
    try:
        major, minor = sys.version_info[:2]
        return (major, minor) >= (3, 13)
    except Exception:
        return False


def _get_pydantic_major_version() -> int:
    try:
        version = getattr(pydantic, "__version__", "1.0.0")
        return int(str(version).split(".")[0])
    except Exception:
        return 1


def _patch_pydantic_v1_forwardref_for_py313() -> None:
    """Patch pydantic.v1 forward-ref evaluation for Python 3.13.

    Python 3.13 changed typing.ForwardRef._evaluate signature to require
    the keyword-only argument "recursive_guard". Pydantic v1 calls into
    ForwardRef without that kwarg, causing a TypeError at import time.

    We monkey-patch pydantic.typing.evaluate_forwardref to ensure the
    correct invocation in 3.13+ while leaving other behavior unchanged.
    """
    if not _is_py313_or_newer():
        return

    try:
        import pydantic.typing as pyd_typing  # type: ignore
    except Exception:
        return

    original_evaluate_forwardref = getattr(pyd_typing, "evaluate_forwardref", None)
    ForwardRef = getattr(typing, "ForwardRef", None)

    if not callable(original_evaluate_forwardref) or ForwardRef is None:
        return

    def _evaluate_forwardref_patched(type_, globalns, localns):  # type: ignore[no-redef]
        try:
            # If this is the standard typing.ForwardRef, call with the kw-only arg
            if isinstance(type_, ForwardRef):
                return type_._evaluate(globalns=globalns, localns=localns, recursive_guard=set())
        except TypeError:
            # Fallback in case typing internals differ
            return type_._evaluate(globalns, localns, set())
        # Non-ForwardRef types: defer to original implementation
        return original_evaluate_forwardref(type_, globalns, localns)

    try:
        pyd_typing.evaluate_forwardref = _evaluate_forwardref_patched  # type: ignore[attr-defined]
    except Exception:
        # If we fail to set the attribute, silently skip to avoid blocking startup
        pass


def apply_patches() -> None:
    major = _get_pydantic_major_version()
    if major == 1:
        _patch_pydantic_v1_forwardref_for_py313()
    # For Pydantic v2, no patches are required


# Apply patches at import time
apply_patches()

