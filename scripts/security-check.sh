#!/bin/bash
# Security Check Script for CI/CD
# Scans for hard-coded secrets, vulnerable dependencies, and security issues

set -e

echo "🔒 Running Security Checks..."

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

ERRORS=0
WARNINGS=0

# Check for hard-coded secrets
echo "📋 Checking for hard-coded secrets..."
SECRET_PATTERNS=(
    "amzn1\.application-oa2-client\.[a-zA-Z0-9]{20,}"
    "Atzr\|[a-zA-Z0-9\-_]{50,}"
    "amzn1\.oa2-cs\.v1\.[a-zA-Z0-9]{20,}"
    "sk_live_[a-zA-Z0-9]{20,}"
    "sk_test_[a-zA-Z0-9]{20,}"
    "SG\.[a-zA-Z0-9\-_]{50,}"
)

FOUND_SECRETS=0
for pattern in "${SECRET_PATTERNS[@]}"; do
    # Search in source files (exclude node_modules, .git, etc.)
    MATCHES=$(grep -r -E "$pattern" --include="*.ts" --include="*.js" --include="*.py" \
        --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist --exclude-dir=build \
        . 2>/dev/null | grep -v "your-" | grep -v "placeholder" | grep -v "example" | wc -l || echo "0")
    
    if [ "$MATCHES" -gt 0 ]; then
        echo -e "${RED}❌ Found potential hard-coded secrets matching pattern: $pattern${NC}"
        FOUND_SECRETS=$((FOUND_SECRETS + MATCHES))
    fi
done

if [ "$FOUND_SECRETS" -gt 0 ]; then
    echo -e "${RED}❌ Found $FOUND_SECRETS potential hard-coded secrets${NC}"
    ERRORS=$((ERRORS + FOUND_SECRETS))
else
    echo -e "${GREEN}✅ No hard-coded secrets found${NC}"
fi

# Check for vulnerable dependencies (Node.js)
if [ -f "package.json" ]; then
    echo "📦 Checking for vulnerable dependencies..."
    if command -v npm &> /dev/null; then
        npm audit --audit-level=moderate || {
            echo -e "${YELLOW}⚠️  npm audit found vulnerabilities${NC}"
            WARNINGS=$((WARNINGS + 1))
        }
    else
        echo -e "${YELLOW}⚠️  npm not found, skipping dependency check${NC}"
    fi
fi

# Check for vulnerable dependencies (Python)
if [ -f "requirements.txt" ]; then
    echo "📦 Checking Python dependencies..."
    if command -v safety &> /dev/null; then
        safety check --file requirements.txt || {
            echo -e "${YELLOW}⚠️  safety check found vulnerabilities${NC}"
            WARNINGS=$((WARNINGS + 1))
        }
    else
        echo -e "${YELLOW}⚠️  safety not installed, skipping Python dependency check${NC}"
        echo "   Install with: pip install safety"
    fi
fi

# Check for .env files in git
echo "📋 Checking for .env files in git..."
if git ls-files | grep -q "\.env$"; then
    echo -e "${RED}❌ Found .env files in git (should be in .gitignore)${NC}"
    ERRORS=$((ERRORS + 1))
else
    echo -e "${GREEN}✅ No .env files in git${NC}"
fi

# Check for security linting
echo "📋 Checking for security linting..."
if [ -f "package.json" ]; then
    if grep -q "eslint-plugin-security" package.json; then
        echo -e "${GREEN}✅ eslint-plugin-security found in package.json${NC}"
    else
        echo -e "${YELLOW}⚠️  eslint-plugin-security not found in package.json${NC}"
        WARNINGS=$((WARNINGS + 1))
    fi
fi

# Check environment variable validation
echo "📋 Checking environment variable validation..."
if [ -f "Integrations-backend/src/security/envValidation.ts" ]; then
    echo -e "${GREEN}✅ Environment validation found${NC}"
else
    echo -e "${RED}❌ Environment validation not found${NC}"
    ERRORS=$((ERRORS + 1))
fi

# Summary
echo ""
echo "=========================================="
echo "Security Check Summary"
echo "=========================================="
echo -e "Errors: ${RED}$ERRORS${NC}"
echo -e "Warnings: ${YELLOW}$WARNINGS${NC}"

if [ "$ERRORS" -gt 0 ]; then
    echo -e "${RED}❌ Security check failed${NC}"
    exit 1
elif [ "$WARNINGS" -gt 0 ]; then
    echo -e "${YELLOW}⚠️  Security check passed with warnings${NC}"
    exit 0
else
    echo -e "${GREEN}✅ Security check passed${NC}"
    exit 0
fi

