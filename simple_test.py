import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

try:
    from src.acg.filer import file_claim
    print("✅ filer.py imports successfully")
    
    # Check if file_claim function exists and what it expects
    import inspect
    sig = inspect.signature(file_claim)
    print(f"📋 file_claim signature: {sig}")
    
except Exception as e:
    print(f"❌ Error: {e}")
    print("Let's check what's in filer.py:")
    with open('src/acg/filer.py', 'r') as f:
        content = f.read()
        print(content[:500])  # First 500 chars
