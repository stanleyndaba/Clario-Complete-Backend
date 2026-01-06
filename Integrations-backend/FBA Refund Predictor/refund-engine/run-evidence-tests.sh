#!/bin/bash

# Evidence & Value Engine Test Runner
# This script runs the MVP tests for the Evidence Engine

echo "🧪 Evidence & Value Engine MVP Test Runner"
echo "=========================================="

# Check if Jest is installed
if ! command -v npx jest &> /dev/null; then
    echo "❌ Jest not found. Installing dependencies..."
    npm install
fi

# Set test environment
export NODE_ENV=test

echo "📋 Running Evidence Engine tests..."
echo ""

# Run the evidence engine tests
npx jest tests/evidenceEngine.test.ts --verbose --detectOpenHandles

# Check exit code
if [ $? -eq 0 ]; then
    echo ""
    echo "✅ All Evidence Engine tests passed!"
    echo ""
    echo "🎯 Test Summary:"
    echo "  - POST /api/v1/claims/flag: ✅ Working"
    echo "  - GET /api/v1/proofs/:id: ✅ Working"
    echo "  - Anomaly detection: ✅ Stubbed"
    echo "  - Entity extraction: ✅ Stubbed"
    echo "  - Proof bundles: ✅ Deterministic"
    echo "  - Append-only: ✅ Enforced"
    echo ""
    echo "🚀 Evidence & Value Engine MVP is ready!"
else
    echo ""
    echo "❌ Some tests failed. Check the output above."
    echo ""
    echo "🔧 Troubleshooting:"
    echo "  1. Ensure all dependencies are installed: npm install"
    echo "  2. Check TypeScript compilation: npm run build"
    echo "  3. Verify Jest configuration: jest --showConfig"
    echo "  4. Run individual tests: npx jest tests/evidenceEngine.test.ts --verbose"
    exit 1
fi
