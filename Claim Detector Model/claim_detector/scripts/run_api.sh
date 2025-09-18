#!/bin/bash

# API run script for FBA reimbursement claim detection

set -e  # Exit on any error

echo "Starting FBA reimbursement claim detection API..."

# Set environment variables
export PYTHONPATH="${PYTHONPATH}:$(pwd)"
export API_HOST="0.0.0.0"
export API_PORT="8000"

# Check if model exists
if [ ! -f "models/claim_detector_model.pkl" ]; then
    echo "Warning: Model file not found. Please run training first:"
    echo "  ./scripts/run_training.sh"
    echo ""
    echo "Starting API without model (will return errors for predictions)..."
fi

# Create necessary directories
mkdir -p logs data/feedback

# Start the API server
echo "Starting FastAPI server on http://$API_HOST:$API_PORT"
echo "API Documentation: http://$API_HOST:$API_PORT/docs"
echo "Health Check: http://$API_HOST:$API_PORT/health"
echo ""
echo "Press Ctrl+C to stop the server"
echo ""

# Run the API
python -m uvicorn api.main:app \
    --host $API_HOST \
    --port $API_PORT \
    --reload \
    --workers 1 \
    --log-level info 