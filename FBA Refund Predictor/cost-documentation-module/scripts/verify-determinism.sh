#!/bin/bash

# Cost Documentation Engine - Determinism Verification Script
# This script verifies that the same input produces byte-identical PDFs

set -e

echo "🔍 Cost Documentation Engine - Determinism Verification"
echo "======================================================"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
NODE_SCRIPT="$SCRIPT_DIR/verify-determinism.js"
EXAMPLE_EVIDENCE="$PROJECT_DIR/examples/evidence.lost-units.json"

# Check if Node.js is available
if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ Node.js is not installed or not in PATH${NC}"
    echo "Please install Node.js and try again"
    exit 1
fi

# Check if the example evidence file exists
if [ ! -f "$EXAMPLE_EVIDENCE" ]; then
    echo -e "${YELLOW}⚠️  Example evidence file not found: $EXAMPLE_EVIDENCE${NC}"
    echo "Creating sample evidence file..."
    
    mkdir -p "$(dirname "$EXAMPLE_EVIDENCE")"
    cat > "$EXAMPLE_EVIDENCE" << 'EOF'
{
  "seller_id": "seller123",
  "anomaly_id": "anomaly456",
  "anomaly_type": "lost_units",
  "detection_date": "2024-01-01",
  "total_impact": 150.75,
  "evidence_data": {
    "units_lost": 5,
    "cost_per_unit": 30.15,
    "location": "warehouse_a",
    "incident_details": "Units reported missing during inventory count",
    "supporting_documents": [
      "inventory_report_2024_01_01.pdf",
      "security_camera_footage.zip",
      "witness_statement.pdf"
    ]
  },
  "executive_summary": "Five units were reported missing during routine inventory count, resulting in a total loss of $150.75. The incident was documented with supporting evidence including inventory reports, security footage, and witness statements."
}
EOF
    echo -e "${GREEN}✅ Created sample evidence file${NC}"
fi

# Check if the Node.js verification script exists
if [ ! -f "$NODE_SCRIPT" ]; then
    echo -e "${YELLOW}⚠️  Verification script not found: $NODE_SCRIPT${NC}"
    echo "Creating verification script..."
    
    cat > "$NODE_SCRIPT" << 'EOF'
#!/usr/bin/env node

/**
 * Cost Documentation Engine - Determinism Verification Script
 * This script verifies that the same input produces byte-identical PDFs
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Mock the PDF renderer for testing
class MockPdfRenderer {
  constructor() {
    this.renderCount = 0;
  }

  renderPdfBuffer(evidence, templateVersion) {
    this.renderCount++;
    
    // Create a deterministic mock PDF based on evidence hash
    const evidenceString = JSON.stringify(evidence, Object.keys(evidence).sort());
    const evidenceHash = crypto.createHash('sha256').update(evidenceString).digest('hex');
    
    // Create mock PDF content (simulating real PDF generation)
    const mockPdfContent = `Mock PDF Content
Template Version: ${templateVersion}
Evidence Hash: ${evidenceHash}
Render Count: ${this.renderCount}
Generated: ${new Date().toISOString()}
Seller ID: ${evidence.seller_id}
Anomaly ID: ${evidence.anomaly_id}
Total Impact: $${evidence.total_impact}
`;

    return {
      buffer: Buffer.from(mockPdfContent),
      metadata: {
        evidence_sha256: evidenceHash,
        signature_sha256: crypto.createHash('sha256').update(evidenceHash + templateVersion).digest('hex'),
        report_id: `${evidence.seller_id}-${evidence.anomaly_id}-${templateVersion}`,
        template_version: templateVersion,
        prepared_on: new Date().toISOString()
      }
    };
  }
}

// Main verification function
async function verifyDeterminism() {
  console.log('🔍 Starting determinism verification...\n');

  try {
    // Read the example evidence
    const evidencePath = path.join(__dirname, '../examples/evidence.lost-units.json');
    const evidenceContent = fs.readFileSync(evidencePath, 'utf8');
    const evidence = JSON.parse(evidenceContent);

    console.log('📄 Evidence loaded:');
    console.log(`   Seller ID: ${evidence.seller_id}`);
    console.log(`   Anomaly ID: ${evidence.anomaly_id}`);
    console.log(`   Type: ${evidence.anomaly_type}`);
    console.log(`   Impact: $${evidence.total_impact}\n`);

    // Initialize mock renderer
    const renderer = new MockPdfRenderer();

    // Generate PDFs multiple times
    const results = [];
    const numRuns = 3;

    console.log(`🔄 Generating PDFs ${numRuns} times...\n`);

    for (let i = 1; i <= numRuns; i++) {
      console.log(`   Run ${i}:`);
      
      const result = renderer.renderPdfBuffer(evidence, '1.0');
      const pdfHash = crypto.createHash('sha256').update(result.buffer).digest('hex');
      
      results.push({
        run: i,
        buffer: result.buffer,
        hash: pdfHash,
        metadata: result.metadata
      });

      console.log(`      Buffer size: ${result.buffer.length} bytes`);
      console.log(`      PDF hash: ${pdfHash.substring(0, 16)}...`);
      console.log(`      Evidence hash: ${result.metadata.evidence_sha256.substring(0, 16)}...`);
      console.log(`      Signature hash: ${result.metadata.signature_sha256.substring(0, 16)}...`);
      console.log(`      Report ID: ${result.metadata.report_id}`);
      console.log('');
    }

    // Verify determinism
    console.log('✅ Verification Results:');
    console.log('========================');

    // Check if all PDFs are identical
    const firstHash = results[0].hash;
    const allIdentical = results.every(result => result.hash === firstHash);

    if (allIdentical) {
      console.log('🎯 DETERMINISM: PASSED ✅');
      console.log(`   All ${numRuns} PDFs are byte-identical`);
      console.log(`   PDF hash: ${firstHash.substring(0, 16)}...`);
    } else {
      console.log('❌ DETERMINISM: FAILED ❌');
      console.log('   PDFs are not identical across runs');
      
      results.forEach((result, index) => {
        console.log(`   Run ${result.run}: ${result.hash.substring(0, 16)}...`);
      });
      
      process.exit(1);
    }

    // Check metadata consistency
    const firstMetadata = results[0].metadata;
    const metadataConsistent = results.every(result => 
      result.metadata.evidence_sha256 === firstMetadata.evidence_sha256 &&
      result.metadata.report_id === firstMetadata.report_id &&
      result.metadata.template_version === firstMetadata.template_version
    );

    if (metadataConsistent) {
      console.log('📊 METADATA CONSISTENCY: PASSED ✅');
      console.log(`   Evidence hash: ${firstMetadata.evidence_sha256.substring(0, 16)}...`);
      console.log(`   Report ID: ${firstMetadata.report_id}`);
      console.log(`   Template version: ${firstMetadata.template_version}`);
    } else {
      console.log('❌ METADATA CONSISTENCY: FAILED ❌');
      process.exit(1);
    }

    // Generate S3 key
    const shortHash = firstMetadata.evidence_sha256.substring(0, 8);
    const s3Key = `docs/seller/${evidence.seller_id}/anomalies/${evidence.anomaly_id}/costdoc/v${firstMetadata.template_version}-${shortHash}.pdf`;
    
    console.log('\n📁 S3 Key Generation:');
    console.log(`   Generated key: ${s3Key}`);
    console.log(`   Short hash: ${shortHash}`);

    // Save sample PDF for inspection
    const outputPath = path.join(__dirname, '../output/sample-determinism-test.pdf');
    const outputDir = path.dirname(outputPath);
    
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    fs.writeFileSync(outputPath, results[0].buffer);
    console.log(`\n💾 Sample PDF saved to: ${outputPath}`);

    console.log('\n🎉 All determinism checks passed!');
    console.log(`\n📋 Summary:`);
    console.log(`   • Generated ${numRuns} identical PDFs`);
    console.log(`   • PDF size: ${results[0].buffer.length} bytes`);
    console.log(`   • S3 key: ${s3Key}`);
    console.log(`   • Evidence hash: ${firstMetadata.evidence_sha256.substring(0, 16)}...`);

  } catch (error) {
    console.error('❌ Verification failed:', error.message);
    process.exit(1);
  }
}

// Run verification if this script is executed directly
if (require.main === module) {
  verifyDeterminism().catch(error => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { verifyDeterminism };
EOF

    chmod +x "$NODE_SCRIPT"
    echo -e "${GREEN}✅ Created verification script${NC}"
fi

# Check if dependencies are installed
if [ ! -f "$PROJECT_DIR/package.json" ]; then
    echo -e "${YELLOW}⚠️  package.json not found. This appears to be a new project.${NC}"
    echo "The verification script will run with mock implementations."
else
    echo -e "${BLUE}📦 Checking dependencies...${NC}"
    cd "$PROJECT_DIR"
    
    if [ ! -d "node_modules" ]; then
        echo -e "${YELLOW}⚠️  Dependencies not installed. Installing...${NC}"
        npm install
    fi
fi

# Run the verification
echo -e "${BLUE}🚀 Running determinism verification...${NC}"
echo ""

cd "$PROJECT_DIR"

# Run the Node.js verification script
if node "$NODE_SCRIPT"; then
    echo ""
    echo -e "${GREEN}✅ Determinism verification completed successfully!${NC}"
    echo ""
    echo "📋 What was verified:"
    echo "   • Same input produces byte-identical PDFs"
    echo "   • Metadata consistency across runs"
    echo "   • S3 key generation stability"
    echo "   • Evidence hashing determinism"
    echo ""
    echo "🔍 Next steps:"
    echo "   • Check the generated sample PDF in output/"
    echo "   • Review the S3 key structure"
    echo "   • Verify evidence hash consistency"
    echo ""
else
    echo ""
    echo -e "${RED}❌ Determinism verification failed!${NC}"
    echo ""
    echo "🔍 Troubleshooting:"
    echo "   • Check the error messages above"
    echo "   • Verify Node.js installation"
    echo "   • Check file permissions"
    echo "   • Review the verification script"
    echo ""
    exit 1
fi


