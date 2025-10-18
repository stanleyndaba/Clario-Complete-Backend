import uvicorn
from simple_app import app

if __name__ == "__main__":
    print("🚀 Starting Clario Parser API on http://0.0.0.0:8002")
    print("📝 Step 5 Document Parser ready for Step 4 connections")
    print("🎯 Step 3 → Step 6 Evidence Matching ready")
    print("⏹️  Press CTRL+C to stop the server")
    
    uvicorn.run(
        app, 
        host="0.0.0.0", 
        port=8002, 
        log_level="info",
        access_log=True,
        reload=False
    )
