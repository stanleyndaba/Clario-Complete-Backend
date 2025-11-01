#!/usr/bin/env python3
"""
Quick Auth Test Runner for Clario Backend
Runs authentication tests with proper environment setup
"""

import asyncio
import sys
import os
import subprocess
from pathlib import Path

def check_dependencies():
    """Check if required dependencies are installed"""
    required_packages = ['httpx', 'websockets', 'pyjwt']
    missing_packages = []
    
    for package in required_packages:
        try:
            __import__(package)
        except ImportError:
            missing_packages.append(package)
    
    if missing_packages:
        print(f"❌ Missing required packages: {', '.join(missing_packages)}")
        print("Installing missing packages...")
        try:
            subprocess.check_call([sys.executable, '-m', 'pip', 'install'] + missing_packages)
            print("✅ Dependencies installed successfully")
        except subprocess.CalledProcessError:
            print("❌ Failed to install dependencies")
            return False
    
    return True

def check_backend_running():
    """Check if the backend server is running"""
    import httpx
    
    try:
        with httpx.Client(timeout=3.0) as client:
            response = client.get("http://localhost:8000/health")
            if response.status_code == 200:
                print("✅ Backend server is running")
                return True
            else:
                print(f"⚠️  Backend responded with status: {response.status_code}")
                return False
    except Exception as e:
        print(f"❌ Backend server not accessible: {e}")
        print("\n💡 To start the backend server:")
        print("   cd C:\\Users\\Student\\Contacts\\Clario-Complete-Backend")
        print("   python -m uvicorn src.app:app --reload --host 0.0.0.0 --port 8000")
        return False

async def run_auth_tests():
    """Run the authentication tests"""
    print("🚀 STARTING CLARIO AUTH TESTS")
    print("=" * 50)
    
    # Check dependencies
    if not check_dependencies():
        return False
    
    # Check if backend is running
    if not check_backend_running():
        return False
    
    # Import and run the test
    try:
        from test_auth_phase1 import run_comprehensive_auth_test
        result = await run_comprehensive_auth_test()
        return result
    except ImportError as e:
        print(f"❌ Failed to import test module: {e}")
        return False
    except Exception as e:
        print(f"❌ Test execution failed: {e}")
        return False

def main():
    """Main entry point"""
    print("🔐 CLARIO BACKEND AUTH TEST RUNNER")
    print("Testing Phase 1: Zero-Friction Onboarding")
    print("=" * 50)
    
    # Set up environment
    os.chdir(Path(__file__).parent)
    
    # Run tests
    try:
        result = asyncio.run(run_auth_tests())
        if result:
            print("\n🎉 ALL TESTS PASSED!")
            print("Your authentication system is ready for Phase 1 testing")
        else:
            print("\n❌ TESTS FAILED")
            print("Please check the error messages and fix the issues")
        
        return 0 if result else 1
        
    except KeyboardInterrupt:
        print("\n⚠️  Tests interrupted by user")
        return 1
    except Exception as e:
        print(f"\n❌ Unexpected error: {e}")
        return 1

if __name__ == "__main__":
    exit(main())