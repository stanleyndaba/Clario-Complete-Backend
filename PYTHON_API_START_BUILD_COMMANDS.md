# 🚀 Python API Start & Build Commands

## For Render.com Deployment

### Build Command
```bash
pip install -r requirements.txt
```

### Start Command
```bash
uvicorn src.app:app --host 0.0.0.0 --port ${PORT:-8000}
```

**OR** (if Render auto-sets PORT environment variable):
```bash
uvicorn src.app:app --host 0.0.0.0 --port $PORT
```

## For Local Development

### Build/Install Dependencies
```bash
pip install -r requirements.txt
```

### Start Command
```bash
uvicorn src.app:app --host 0.0.0.0 --port 8000 --reload
```

Or using Python directly:
```bash
python -m uvicorn src.app:app --host 0.0.0.0 --port 8000 --reload
```

## For Docker Deployment

### Build Command
```bash
docker build -t opside-python-api .
```

### Start Command
```dockerfile
# Already in Dockerfile CMD, but here for reference:
uvicorn src.app:app --host 0.0.0.0 --port ${PORT:-10000}
```

## Render.com Configuration

### Service Settings
- **Name**: `opside-python-api` (or your preferred name)
- **Environment**: `Python 3`
- **Python Version**: `3.11.4` (or match your PYTHON_VERSION env var)
- **Build Command**: `pip install -r requirements.txt`
- **Start Command**: `uvicorn src.app:app --host 0.0.0.0 --port $PORT`
- **Health Check Path**: `/health` (if available) or `/api/health`

### Port Configuration
- Render automatically sets the `PORT` environment variable
- Your app should bind to `0.0.0.0` and use `$PORT`
- The `${PORT:-8000}` syntax means "use PORT env var, or 8000 if not set"

## Alternative Start Commands

### With Workers (Production)
```bash
uvicorn src.app:app --host 0.0.0.0 --port $PORT --workers 4
```

### With Logging
```bash
uvicorn src.app:app --host 0.0.0.0 --port $PORT --log-level info --access-log
```

### With Timeout Settings
```bash
uvicorn src.app:app --host 0.0.0.0 --port $PORT --timeout-keep-alive 5
```

## Quick Reference

| Environment | Build Command | Start Command |
|-------------|---------------|---------------|
| **Render.com** | `pip install -r requirements.txt` | `uvicorn src.app:app --host 0.0.0.0 --port $PORT` |
| **Local Dev** | `pip install -r requirements.txt` | `uvicorn src.app:app --host 0.0.0.0 --port 8000 --reload` |
| **Docker** | `docker build -t opside-python-api .` | `docker run -p 8000:8000 opside-python-api` |

## Troubleshooting

### If the app doesn't start:
1. Check that `requirements.txt` has `uvicorn` installed
2. Verify `src/app.py` exists and has `app = FastAPI(...)`
3. Check that `PYTHONPATH` includes the `src` directory
4. Verify PORT environment variable is set (Render sets this automatically)

### If you get import errors:
- Make sure `PYTHONPATH=/app/src` is set (or `PYTHONPATH=./src` locally)
- The app imports from `src.app`, so the Python path must include the parent directory

### If PORT binding fails:
- Use `0.0.0.0` (not `127.0.0.1` or `localhost`) to bind to all interfaces
- Render requires binding to `0.0.0.0` for external access

