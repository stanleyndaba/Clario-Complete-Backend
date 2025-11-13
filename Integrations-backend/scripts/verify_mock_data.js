/**
 * Verify Mock SP-API Data Setup
 * Checks that all required CSV files exist and have data
 */

const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');

// Handle both local development and Render paths
let dataDir;
if (process.cwd().includes('Integrations-backend')) {
  // We're in Integrations-backend, go up one level
  dataDir = path.join(process.cwd(), '..', 'data', 'mock-spapi');
} else {
  // We're at project root
  dataDir = path.join(process.cwd(), 'data', 'mock-spapi');
}
const requiredFiles = [
  'financial_events.csv',
  'orders.csv',
  'inventory.csv',
  'fees.csv',
  'shipments_returns.csv'
];

console.log('🔍 Verifying Mock SP-API Data Setup...\n');
console.log(`Data directory: ${dataDir}\n`);

let allGood = true;
const results = {};

for (const filename of requiredFiles) {
  const filePath = path.join(dataDir, filename);
  
  if (!fs.existsSync(filePath)) {
    console.log(`❌ ${filename} - NOT FOUND`);
    allGood = false;
    results[filename] = { exists: false, recordCount: 0 };
    continue;
  }
  
  try {
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    const records = parse(fileContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true
    });
    
    const recordCount = records.length;
    const hasHeaders = fileContent.includes(',');
    
    if (recordCount > 0 || filename === 'shipments_returns.csv') {
      console.log(`✅ ${filename} - ${recordCount} records`);
      results[filename] = { exists: true, recordCount };
    } else {
      console.log(`⚠️  ${filename} - Empty (headers only)`);
      results[filename] = { exists: true, recordCount: 0, warning: 'empty' };
    }
  } catch (error) {
    console.log(`❌ ${filename} - ERROR: ${error.message}`);
    allGood = false;
    results[filename] = { exists: true, recordCount: 0, error: error.message };
  }
}

console.log('\n📊 Summary:');
console.log(`Total files: ${requiredFiles.length}`);
console.log(`Files found: ${Object.values(results).filter(r => r.exists).length}`);
console.log(`Total records: ${Object.values(results).reduce((sum, r) => sum + (r.recordCount || 0), 0)}`);

if (allGood) {
  console.log('\n✅ All required files are present!');
  console.log('\n📋 Next Steps:');
  console.log('1. Set USE_MOCK_SPAPI=true in your .env file');
  console.log('2. Restart the backend: npm run dev');
  console.log('3. Trigger a sync - it will use your CSV files!');
} else {
  console.log('\n❌ Some files are missing or have errors. Please check above.');
}

module.exports = { results, allGood };

