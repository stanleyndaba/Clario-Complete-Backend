# sitecustomize.py - Early Python 3.13 compatibility patch
# This runs at interpreter startup before any other code
import sys
import os

try:
    # Add src to path so we can import the compatibility patch
    src_dir = os.path.join(os.path.dirname(__file__), 'src')
    if os.path.exists(src_dir) and src_dir not in sys.path:
        sys.path.insert(0, src_dir)
    
    # Apply compatibility patches
    from compatibility_patch import apply_patches
    apply_patches()
    print("[sitecustomize] Python 3.13 compatibility patches applied")
except Exception as e:
    print(f"[sitecustomize-warning] Failed to apply compatibility patches: {e}")
