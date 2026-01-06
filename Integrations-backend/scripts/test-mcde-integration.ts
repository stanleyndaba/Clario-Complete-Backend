/**
 * Test MCDE Integration
 * 
 * Tests the MCDE OCR extraction and cost component parsing functionality.
 * Run with: npx ts-node scripts/test-mcde-integration.ts
 */

import mcdeService from '../src/services/mcdeService';
import logger from '../src/utils/logger';

async function testMCDEIntegration() {
    console.log('\n=== MCDE Integration Test ===\n');

    // Test 1: Health Check
    console.log('1. Testing MCDE health check...');
    const health = await mcdeService.healthCheck();
    if (health) {
        console.log('   ✅ MCDE service is healthy:', health);
    } else {
        console.log('   ⚠️  MCDE service not available (may not be deployed)');
    }

    // Test 2: Check if MCDE is enabled
    console.log('\n2. Checking if MCDE is enabled...');
    const enabled = mcdeService.isEnabled();
    console.log(`   ${enabled ? '✅' : '❌'} MCDE enabled: ${enabled}`);
    console.log(`   Set ENABLE_MCDE_INTEGRATION=true to enable`);

    // Test 3: Test needsOCR detection
    console.log('\n3. Testing file type detection...');
    const testFiles = [
        { name: 'invoice.pdf', type: 'application/pdf', expectOCR: false },
        { name: 'scan.jpg', type: 'image/jpeg', expectOCR: true },
        { name: 'chinese_invoice.png', type: 'image/png', expectOCR: true },
        { name: 'receipt.tiff', type: 'image/tiff', expectOCR: true },
        { name: 'document.txt', type: 'text/plain', expectOCR: false },
    ];

    for (const file of testFiles) {
        const needsOCR = mcdeService.needsOCR(file.name, file.type);
        const correct = needsOCR === file.expectOCR;
        console.log(`   ${correct ? '✅' : '❌'} ${file.name}: needsOCR=${needsOCR} (expected ${file.expectOCR})`);
    }

    // Test 4: Test Chinese pattern parsing
    console.log('\n4. Testing Chinese cost pattern extraction...');

    const sampleChineseText = `
    发票号: INV-2024-001
    供应商: 深圳市制造有限公司
    
    商品明细:
    材料费: ¥5,000.00
    人工费: ¥2,500.00
    运费: ¥500.00
    税费: ¥800.00
    
    单位成本: ¥8.50
    总成本: ¥8,800.00
  `;

    const costComponents = mcdeService.parseChineseCostPatterns(sampleChineseText);
    console.log('   Extracted cost components:');
    console.log(`   - Material Cost: ${costComponents.material_cost ?? 'not found'}`);
    console.log(`   - Labor Cost: ${costComponents.labor_cost ?? 'not found'}`);
    console.log(`   - Shipping Cost: ${costComponents.shipping_cost ?? 'not found'}`);
    console.log(`   - Tax Cost: ${costComponents.tax_cost ?? 'not found'}`);
    console.log(`   - Unit Manufacturing Cost: ${costComponents.unit_manufacturing_cost ?? 'not found'}`);
    console.log(`   - Total Cost: ${costComponents.total_cost ?? 'not found'}`);

    // Check if key fields were extracted
    const extracted = Object.keys(costComponents).length;
    console.log(`\n   ${extracted >= 3 ? '✅' : '⚠️ '} Extracted ${extracted}/6 cost fields from Chinese text`);

    // Summary
    console.log('\n=== Summary ===');
    console.log(`MCDE Service: ${enabled ? 'ENABLED' : 'DISABLED'}`);
    console.log(`MCDE API: ${health ? 'AVAILABLE' : 'NOT AVAILABLE'}`);
    console.log(`Chinese Pattern Parsing: ${extracted >= 3 ? 'WORKING' : 'NEEDS TESTING'}`);

    if (!enabled) {
        console.log('\n⚠️  To enable MCDE, set these environment variables:');
        console.log('   ENABLE_MCDE_INTEGRATION=true');
        console.log('   MCDE_OCR_LANGUAGE=eng+chi_sim');
        console.log('   MCDE_OCR_TIMEOUT=60');
    }

    console.log('\n');
}

// Run test
testMCDEIntegration().catch(console.error);
