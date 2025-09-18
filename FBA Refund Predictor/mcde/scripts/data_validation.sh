#!/bin/bash
set -e

echo "Starting MCDE data validation..."

# Set environment variables
export PYTHONPATH="${PYTHONPATH}:$(pwd)"

# Run data validation
python -m src.data.compliance_validation

echo "Data validation completed!" 