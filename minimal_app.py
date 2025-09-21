from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Minimal CORS Test App")

origins = ["https://opside-complete-frontend.onrender.com"]

print(f"\n\n🚨 CORS CONFIG: Using origins: {origins}\n")

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

print("🚨 APP MIDDLEWARES:")
for mw in app.user_middleware:
    print(f"🚨 {mw}")

@app.get("/")
async def root():
    return {"message": "Minimal app running"}

@app.get("/health")
async def health():
    return {"status": "healthy", "message": "API is running successfully"}

@app.get("/cors/debug")
async def cors_debug():
    return {"allow_origins": origins, "allow_origin_regex": None}

@app.get("/_debug/middleware")
async def list_middleware():
    return {"user_middleware": [str(mw) for mw in app.user_middleware]}

