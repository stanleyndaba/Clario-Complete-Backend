#!/bin/bash
set -e

echo "Starting MCDE API server..."

# Set environment variables
export PYTHONPATH="${PYTHONPATH}:$(pwd)"

# Run the API server
uvicorn src.api.main:app --host 0.0.0.0 --port 8000 --reload

echo "MCDE API server started!" 