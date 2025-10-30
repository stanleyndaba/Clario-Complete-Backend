from fastapi import FastAPI

app = FastAPI(title="Test API", docs_url="/docs")

@app.get("/")
def root():
    return {"message": "Test API", "version": "1.0.0"}

@app.get("/integrations")
def integrations():
    return {
        "status": "ok",
        "integrations": [
            {"name": "amazon", "status": "available"},
            {"name": "gmail", "status": "available"},
            {"name": "stripe", "status": "available"}
        ]
    }

@app.get("/health")
def health():
    return {"status": "ok", "timestamp": "2025-10-30T01:38:00.000Z"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)