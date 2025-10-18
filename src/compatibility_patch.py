"""
Updated compatibility patch for Pydantic V2
This fixes the broken imports from the old patch
"""
import pydantic
from pydantic import v1 as pydantic_v1

# For Pydantic V2 compatibility
try:
    # Try V2 imports first
    from pydantic import TypeAdapter
    evaluate_forwardref = None  # Not needed in V2
except ImportError:
    # Fallback to V1 behavior
    evaluate_forwardref = pydantic_v1.typing.evaluate_forwardref

# No-op the problematic function that breaks V2
def patch_pydantic():
    """Apply compatibility patches for Pydantic V2"""
    pass

# Apply patches automatically
patch_pydantic()
