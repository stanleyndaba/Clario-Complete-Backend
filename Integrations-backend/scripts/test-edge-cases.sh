#!/bin/bash

# Discovery Stage Edge Case Tests
# This script runs comprehensive tests for production-ready error handling

set -e

echo "🧪 Running Discovery Stage Edge Case Tests..."
echo "=============================================="

# Set test environment
export NODE_ENV=test
export JWT_SECRET=test-secret-key
export FRONTEND_URL=http://localhost:3000

# Run the edge case tests
echo "📋 Running edge case tests..."
npm test -- --testPathPattern=edgeCases.test.ts --verbose

echo ""
echo "✅ Edge case tests completed!"
echo ""
echo "📊 Test Summary:"
echo "- Amazon OAuth callback failures"
echo "- Revoked/expired token handling"
echo "- Stripe customer creation failures"
echo "- Integration status endpoints"
echo "- SSE authentication protection"
echo "- Session handling"
echo "- Error logging and monitoring"
echo ""
echo "🔍 To run specific test suites:"
echo "  npm test -- --testNamePattern='Amazon OAuth Edge Cases'"
echo "  npm test -- --testNamePattern='Stripe Customer Creation Edge Cases'"
echo "  npm test -- --testNamePattern='Integration Status Endpoints'"
echo ""
echo "📝 To run with coverage:"
echo "  npm test -- --coverage --testPathPattern=edgeCases.test.ts"
