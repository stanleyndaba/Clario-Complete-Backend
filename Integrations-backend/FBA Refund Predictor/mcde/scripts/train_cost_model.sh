#!/bin/bash
set -e

echo "Starting MCDE cost model training..."

# Set environment variables
export PYTHONPATH="${PYTHONPATH}:$(pwd)"

# Run model training
python -m src.models.train

echo "Cost model training completed!" 