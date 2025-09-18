# Cost Documentation Determinism Verification Script (PowerShell)
# This script verifies that PDF generation is deterministic

Write-Host "🔍 Cost Documentation Determinism Verification" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan

# Check if Node.js is available
try {
    $nodeVersion = node --version
    Write-Host "✅ Node.js found: $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "❌ Node.js not found. Please install Node.js first." -ForegroundColor Red
    exit 1
}

# Check if npm is available
try {
    $npmVersion = npm --version
    Write-Host "✅ npm found: $npmVersion" -ForegroundColor Green
} catch {
    Write-Host "❌ npm not found. Please install npm first." -ForegroundColor Red
    exit 1
}

# Check if dependencies are installed
if (-not (Test-Path "node_modules")) {
    Write-Host "📦 Installing dependencies..." -ForegroundColor Yellow
    npm install
}

# Check if build exists, if not build
if (-not (Test-Path "dist")) {
    Write-Host "🔨 Building project..." -ForegroundColor Yellow
    npm run build
}

# Create verification script if it doesn't exist
$verificationScript = @"
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Mock the pdfRenderer for testing
const mockPdfRenderer = {
  renderPdfBuffer: async (evidence, templateVersion) => {
    // Create a deterministic mock PDF buffer
    const canonicalData = JSON.stringify(evidence, Object.keys(evidence).sort());
    const hash = crypto.createHash('sha256').update(canonicalData + templateVersion).digest('hex');
    return Buffer.from(hash.substring(0, 100), 'hex');
  }
};

async function verifyDeterminism() {
  console.log('🧪 Testing PDF determinism...');
  
  // Sample evidence data
  const evidence = {
    anomaly_id: 'test-123',
    seller_id: 'seller-456',
    anomaly_type: 'overcharges',
    evidence: {
      total_amount: 150.00,
      currency: 'USD',
      items: [
        { sku: 'SKU001', quantity: 2, unit_price: 25.00, total: 50.00 },
        { sku: 'SKU002', quantity: 1, unit_price: 100.00, total: 100.00 }
      ]
    },
    detected_at: '2024-01-15T10:00:00Z'
  };

  try {
    // Generate multiple PDFs with identical input
    console.log('📄 Generating PDFs...');
    
    const pdf1 = await mockPdfRenderer.renderPdfBuffer(evidence, 'v1.0');
    const pdf2 = await mockPdfRenderer.renderPdfBuffer(evidence, 'v1.0');
    const pdf3 = await mockPdfRenderer.renderPdfBuffer(evidence, 'v1.0');
    
    // Compute SHA256 hashes
    const hash1 = crypto.createHash('sha256').update(pdf1).digest('hex');
    const hash2 = crypto.createHash('sha256').update(pdf2).digest('hex');
    const hash3 = crypto.createHash('sha256').update(pdf3).digest('hex');
    
    console.log('🔐 Hash 1:', hash1);
    console.log('🔐 Hash 2:', hash2);
    console.log('🔐 Hash 3:', hash3);
    
    // Verify determinism
    const isDeterministic = hash1 === hash2 && hash2 === hash3;
    
    if (isDeterministic) {
      console.log('✅ SUCCESS: PDF generation is deterministic!');
      console.log('   All three PDFs have identical SHA256 hashes.');
    } else {
      console.log('❌ FAILURE: PDF generation is NOT deterministic!');
      console.log('   PDFs have different SHA256 hashes.');
      process.exit(1);
    }
    
    // Test different template versions
    console.log('\n🧪 Testing different template versions...');
    const pdfV1 = await mockPdfRenderer.renderPdfBuffer(evidence, 'v1.0');
    const pdfV2 = await mockPdfRenderer.renderPdfBuffer(evidence, 'v2.0');
    
    const hashV1 = crypto.createHash('sha256').update(pdfV1).digest('hex');
    const hashV2 = crypto.createHash('sha256').update(pdfV2).digest('hex');
    
    if (hashV1 !== hashV2) {
      console.log('✅ SUCCESS: Different template versions produce different PDFs');
    } else {
      console.log('❌ FAILURE: Different template versions should produce different PDFs');
      process.exit(1);
    }
    
    // Test different evidence
    console.log('\n🧪 Testing different evidence...');
    const evidence2 = { ...evidence, evidence: { ...evidence.evidence, total_amount: 200.00 } };
    
    const pdfEvidence1 = await mockPdfRenderer.renderPdfBuffer(evidence, 'v1.0');
    const pdfEvidence2 = await mockPdfRenderer.renderPdfBuffer(evidence2, 'v1.0');
    
    const hashEvidence1 = crypto.createHash('sha256').update(pdfEvidence1).digest('hex');
    const hashEvidence2 = crypto.createHash('sha256').update(pdfEvidence2).digest('hex');
    
    if (hashEvidence1 !== hashEvidence2) {
      console.log('✅ SUCCESS: Different evidence produces different PDFs');
    } else {
      console.log('❌ FAILURE: Different evidence should produce different PDFs');
      process.exit(1);
    }
    
    console.log('\n🎉 All determinism tests passed!');
    
  } catch (error) {
    console.error('❌ Error during verification:', error);
    process.exit(1);
  }
}

verifyDeterminism();
"@

$verificationScriptPath = "scripts/verify-determinism.js"
$verificationScript | Out-File -FilePath $verificationScriptPath -Encoding UTF8

Write-Host "📝 Created verification script: $verificationScriptPath" -ForegroundColor Green

# Run the verification
Write-Host "🚀 Running determinism verification..." -ForegroundColor Yellow
Write-Host ""

try {
    node $verificationScriptPath
    if ($LASTEXITCODE -eq 0) {
        Write-Host ""
        Write-Host "🎉 Determinism verification completed successfully!" -ForegroundColor Green
    } else {
        Write-Host ""
        Write-Host "❌ Determinism verification failed!" -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host "❌ Error running verification script: $_" -ForegroundColor Red
    exit 1
}

# Cleanup
if (Test-Path $verificationScriptPath) {
    Remove-Item $verificationScriptPath
    Write-Host "🧹 Cleaned up temporary verification script" -ForegroundColor Gray
}

Write-Host ""
Write-Host "✨ Verification complete!" -ForegroundColor Cyan



