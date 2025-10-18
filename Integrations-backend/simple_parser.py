from fastapi import FastAPI

app = FastAPI()

@app.get("/api/v1/evidence/parse/jobs")
async def get_jobs():
    return {"status": "Python parser running", "jobs": []}

@app.post("/api/v1/evidence/parse/document")  
async def parse_document():
    return {"parsed": True, "supplier": "Test Supplier", "invoice_number": "INV-001"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
