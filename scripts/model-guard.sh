#!/usr/bin/env bash
set -euo pipefail

PROD_DIR="models/production/current"

if [ ! -d "$PROD_DIR" ]; then
  echo "Missing $PROD_DIR"
  exit 1
fi

count=$(find "$PROD_DIR" -type f ! -name '.gitkeep' | wc -l | tr -d ' ')
echo "Production artifacts: $count"

if [ "$count" -ne 1 ]; then
  echo "Expected exactly 1 artifact in $PROD_DIR, found $count"
  exit 1
fi

echo "Model guard passed"


